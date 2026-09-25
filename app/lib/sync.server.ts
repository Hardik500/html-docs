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
): Promise<number | null> {
  if (isDesktopRuntime() || !ownerUserId) return null;

  const result = await runQuery<{ revision: string }>(
    `UPDATE docs
        SET revision = revision + 1, last_activity_at = now()
      WHERE id = $1 AND owner_user_id = $2
      RETURNING revision`,
    [docId, ownerUserId],
  );
  if (!result.rows.length) return null;

  const revision = Number(result.rows[0].revision);
  await runQuery(
    `INSERT INTO sync_changes (doc_id, owner_user_id, revision)
     VALUES ($1, $2, $3)`,
    [docId, ownerUserId, revision],
  );
  return revision;
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
