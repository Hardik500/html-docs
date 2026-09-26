import { isDesktopRuntime } from "./runtime.server";
import { type QueryRunner, query } from "./db.server";

export interface SyncTab {
  id: string;
  slug: string;
  name: string;
  position: number;
  html: string;
  content_type: "html" | "markdown" | "pdf" | "doc";
}

export interface SyncDocument {
  id: string;
  title: string;
  revision: number;
  deleted: boolean;
  editToken?: string;
  tabs: SyncTab[];
}

export interface PullResponse {
  cursor: number;
  hasMore: boolean;
  documents: SyncDocument[];
}

export interface PushRequest {
  document: {
    id: string;
    title: string;
    baseRevision: number;
    deleted?: boolean;
    force?: boolean;
    forceRevision?: number;
    tabs: SyncTab[];
  };
}

export interface PushResponse {
  id: string;
  revision: number;
  deleted: boolean;
  editToken: string;
}

export function parseSyncCursor(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Response("Invalid sync cursor", { status: 400 });
  }
  return parsed;
}

function mapContentType(value: string): SyncTab["content_type"] {
  return value === "markdown" || value === "pdf" || value === "doc"
    ? value
    : "html";
}

/** Records a hosted document change for desktop pull sync. */
export async function recordDocumentChange(
  runQuery: QueryRunner,
  docId: string,
  ownerUserId: string | null,
  title?: string,
): Promise<number | null> {
  if (isDesktopRuntime() || !ownerUserId) return null;

  // Bump the revision and append the sync-feed row in ONE statement, and fold an
  // optional title update into the same UPDATE. This runs on every save of every
  // write path (web autosave, MCP tools, desktop sync push) against a remote
  // database, so collapsing three round trips into one is the single biggest
  // latency win available here. An owned document that does not exist (or is
  // owned by someone else) makes `bumped` empty, so nothing is inserted and the
  // function reports "no change" exactly as the two-statement version did.
  const result = await runQuery<{ revision: string }>(
    `WITH bumped AS (
       UPDATE docs
          SET title = COALESCE($3, title),
              revision = revision + 1,
              last_activity_at = now()
        WHERE id = $1 AND owner_user_id = $2
        RETURNING revision
     )
     INSERT INTO sync_changes (doc_id, owner_user_id, revision)
     SELECT $1, $2, revision FROM bumped
     RETURNING revision`,
    [docId, ownerUserId, title ? title.slice(0, 500) : null],
  );
  if (!result.rows.length) return null;
  return Number(result.rows[0].revision);
}

/** Marks a local document as needing a future cloud push. */
export async function markLocalDocumentDirty(
  docId: string,
  deleted = false,
  runQuery: QueryRunner = query,
): Promise<void> {
  if (!isDesktopRuntime()) return;

  await runQuery(
    `INSERT INTO sync_state (doc_id, dirty, deleted, change_generation, last_error)
     VALUES ($1, TRUE, $2, 1, NULL)
     ON CONFLICT (doc_id) DO UPDATE
       SET dirty = TRUE,
           deleted = EXCLUDED.deleted,
           change_generation = sync_state.change_generation + 1,
           last_error = NULL`,
    [docId, deleted],
  );
}

export function toSyncDocument(row: {
  id: string;
  title: string;
  revision: string | number;
  deleted_at: string | Date | null;
  edit_token?: string;
}): SyncDocument {
  return {
    id: row.id,
    title: row.title,
    revision: Number(row.revision),
    deleted: Boolean(row.deleted_at),
    editToken: row.edit_token,
    tabs: [],
  };
}

export function toSyncTab(row: {
  id: string;
  slug: string;
  name: string;
  position: number;
  html: string;
  content_type: string;
}): SyncTab {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    position: row.position,
    html: row.html,
    content_type: mapContentType(row.content_type),
  };
}
