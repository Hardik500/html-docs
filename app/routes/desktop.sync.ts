import { createHash } from "node:crypto";
import { redirect } from "react-router";
import type { Route } from "./+types/desktop.sync";
import { newEditToken } from "~/lib/ids";
import { query, withTransaction, type QueryRunner } from "~/lib/db.server";
import { isDesktopRuntime } from "~/lib/runtime.server";
import type { PullResponse, PushResponse, SyncDocument, SyncTab } from "~/lib/sync.server";

function getBearerToken(request: Request): string {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function getAccountCursorKey(request: Request): string {
  const token = getBearerToken(request);
  return `cursor:${createHash("sha256").update(token).digest("hex")}`;
}

function getRemoteUrl(): string {
  const value = process.env.HTML_DOCS_SYNC_URL?.replace(/\/+$/, "");
  if (!value) {
    throw new Response("Desktop cloud sync is not configured", { status: 503 });
  }
  return value;
}

async function remoteRequest(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getBearerToken(request);
  if (!token) throw new Response("Desktop sync token is missing", { status: 401 });

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");

  const response = await fetch(`${getRemoteUrl()}${path}`, {
    ...init,
    headers,
  });
  return response;
}

async function readLocalSnapshot(runQuery: QueryRunner, docId: string) {
  const doc = await runQuery<{
    id: string;
    title: string;
    deleted_at: string | Date | null;
    edit_token: string;
  }>(
    `SELECT id, title, deleted_at, edit_token
       FROM docs
      WHERE id = $1`,
    [docId],
  );
  if (!doc.rows.length) return null;

  const tabs = await runQuery<{
    id: string;
    slug: string;
    name: string;
    position: number;
    html: string;
    content_type: string;
  }>(
    `SELECT id, slug, name, position, html, content_type
       FROM tabs
      WHERE doc_id = $1
      ORDER BY position ASC`,
    [docId],
  );
  return {
    document: doc.rows[0],
    tabs: tabs.rows,
  };
}

async function applyRemoteDocument(
  runQuery: QueryRunner,
  remote: SyncDocument,
): Promise<"applied" | "conflict"> {
  const state = await runQuery<{
    remote_revision: string | number;
    dirty: boolean;
  }>(
    "SELECT remote_revision, dirty FROM sync_state WHERE doc_id = $1",
    [remote.id],
  );
  if (
    state.rows.length &&
    state.rows[0].dirty &&
    Number(remote.revision) > Number(state.rows[0].remote_revision)
  ) {
    const local = await readLocalSnapshot(runQuery, remote.id);
    await runQuery(
      `INSERT INTO sync_conflicts (doc_id, remote_payload, local_payload)
       VALUES ($1, $2, $3)
       ON CONFLICT (doc_id) DO UPDATE
         SET remote_payload = EXCLUDED.remote_payload,
             local_payload = EXCLUDED.local_payload,
             created_at = now()`,
      [remote.id, JSON.stringify(remote), JSON.stringify(local)],
    );
    return "conflict";
  }

  if (remote.deleted) {
    await runQuery("DELETE FROM docs WHERE id = $1", [remote.id]);
    await runQuery("DELETE FROM sync_conflicts WHERE doc_id = $1", [remote.id]);
    return "applied";
  }

  const editToken = remote.editToken || newEditToken();
  await runQuery(
    `INSERT INTO docs (id, title, owner_user_id, edit_token, revision, last_activity_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE
       SET title = EXCLUDED.title,
           owner_user_id = EXCLUDED.owner_user_id,
           edit_token = EXCLUDED.edit_token,
           deleted_at = NULL,
           revision = EXCLUDED.revision,
           last_activity_at = now()`,
    [
      remote.id,
      remote.title,
      "00000000-0000-0000-0000-000000000001",
      editToken,
      remote.revision,
    ],
  );
  await runQuery("DELETE FROM tabs WHERE doc_id = $1", [remote.id]);
  for (const tab of remote.tabs) {
    await runQuery(
      `INSERT INTO tabs (id, doc_id, slug, name, position, html, content_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tab.id,
        remote.id,
        tab.slug,
        tab.name,
        tab.position,
        tab.html,
        tab.content_type,
      ],
    );
  }
  await runQuery(
    `INSERT INTO sync_state (doc_id, remote_revision, dirty, deleted, last_synced_at, last_error)
     VALUES ($1, $2, FALSE, FALSE, now(), NULL)
     ON CONFLICT (doc_id) DO UPDATE
       SET remote_revision = EXCLUDED.remote_revision,
           dirty = FALSE,
           deleted = FALSE,
           last_synced_at = now(),
           last_error = NULL`,
    [remote.id, remote.revision],
  );
  return "applied";
}

async function pullFromCloud(request: Request) {
  const cursorKey = getAccountCursorKey(request);
  const cursorResult = await query<{ value: string }>(
    "SELECT value FROM sync_meta WHERE key = $1",
    [cursorKey],
  );
  let cursor = Number(cursorResult.rows[0]?.value ?? 0);
  let applied = 0;
  const conflicts: string[] = [];
  let hasMore = false;
  let partial = false;

  for (let page = 0; page < 50; page += 1) {
    let maxDocuments = 20;
    let response: Response;
    while (true) {
      response = await remoteRequest(
        request,
        `/sync/pull?cursor=${encodeURIComponent(String(cursor))}&max_documents=${maxDocuments}`,
      );
      if (response.status !== 413 || maxDocuments === 1) break;
      maxDocuments = 1;
    }
    if (!response.ok) {
      throw new Response(await response.text(), { status: response.status });
    }

    const payload = (await response.json()) as PullResponse;
    const result = await withTransaction(async (runQuery) => {
      let pageApplied = 0;
      for (const document of payload.documents) {
        const outcome = await applyRemoteDocument(runQuery, document);
        if (outcome === "conflict") conflicts.push(document.id);
        else pageApplied += 1;
      }
      await runQuery(
        `INSERT INTO sync_meta (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [cursorKey, String(payload.cursor)],
      );
      return pageApplied;
    });
    applied += result;
    cursor = payload.cursor;
    hasMore = payload.hasMore;
    if (!hasMore) {
      return Response.json({
        ok: true,
        mode: "pull",
        applied,
        conflicts,
        cursor,
        hasMore: false,
        partial: false,
      });
    }
  }

  partial = true;
  return Response.json({
    ok: true,
    mode: "pull",
    applied,
    conflicts,
    cursor,
    hasMore,
    partial,
  });
}

async function pushToCloud(request: Request) {
  const dirty = await query<{
    id: string;
    title: string;
    deleted_at: string | Date | null;
    remote_revision: string | number;
    deleted: boolean;
    force_push: boolean;
  }>(
    `SELECT d.id, d.title, d.deleted_at, s.remote_revision, s.deleted, s.force_push
       FROM docs d
       JOIN sync_state s ON s.doc_id = d.id
      WHERE s.dirty = TRUE
      ORDER BY d.last_activity_at ASC`,
  );

  let pushed = 0;
  const conflicts: string[] = [];
  for (const row of dirty.rows) {
    const tabs = await query<{
      id: string;
      slug: string;
      name: string;
      position: number;
      html: string;
      content_type: string;
    }>(
      `SELECT id, slug, name, position, html, content_type
         FROM tabs
        WHERE doc_id = $1
        ORDER BY position ASC`,
      [row.id],
    );
    const document = {
      id: row.id,
      title: row.title,
      baseRevision: Number(row.remote_revision),
      deleted: row.deleted || Boolean(row.deleted_at),
      force: row.force_push,
      tabs: tabs.rows.map((tab) => ({
        id: tab.id,
        slug: tab.slug,
        name: tab.name,
        position: tab.position,
        html: tab.html,
        content_type: tab.content_type as SyncTab["content_type"],
      })),
    };
    const response = await remoteRequest(request, "/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document }),
    });
    if (response.status === 409) {
      conflicts.push(row.id);
      continue;
    }
    if (!response.ok) {
      throw new Response(await response.text(), { status: response.status });
    }
    const result = (await response.json()) as PushResponse;
    await query(
      `UPDATE sync_state
          SET remote_revision = $1, dirty = FALSE, force_push = FALSE, deleted = $2,
              last_synced_at = now(), last_error = NULL
        WHERE doc_id = $3`,
      [result.revision, result.deleted, row.id],
    );
    pushed += 1;
  }

  return Response.json({ ok: true, mode: "push", pushed, conflicts });
}

async function resolveConflict(request: Request) {
  const formData = await request.formData();
  const docId = String(formData.get("docId") ?? "");
  const choice = String(formData.get("choice") ?? "");
  if (!docId || !["remote", "local"].includes(choice)) {
    throw new Response("Invalid conflict resolution", { status: 400 });
  }

  const conflict = await query<{ remote_payload: string }>(
    "SELECT remote_payload FROM sync_conflicts WHERE doc_id = $1",
    [docId],
  );
  if (!conflict.rows.length) {
    throw new Response("Conflict not found", { status: 404 });
  }
  const remote = JSON.parse(conflict.rows[0].remote_payload) as SyncDocument;

  await withTransaction(async (runQuery) => {
    if (choice === "remote") {
      await runQuery(
        `UPDATE sync_state
            SET dirty = FALSE, force_push = FALSE, last_error = NULL
          WHERE doc_id = $1`,
        [docId],
      );
      await runQuery("DELETE FROM sync_conflicts WHERE doc_id = $1", [docId]);
      await applyRemoteDocument(runQuery, remote);
    } else {
      await runQuery(
        `UPDATE sync_state
            SET dirty = TRUE, force_push = TRUE, last_error = NULL
          WHERE doc_id = $1`,
        [docId],
      );
      await runQuery("DELETE FROM sync_conflicts WHERE doc_id = $1", [docId]);
    }
  });

  return redirect("/desktop/conflicts");
}

export async function action({ request }: Route.ActionArgs) {
  if (!isDesktopRuntime()) {
    throw new Response("Not found", { status: 404 });
  }
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }

  const mode = new URL(request.url).searchParams.get("mode");
  if (mode === "pull") return pullFromCloud(request);
  if (mode === "push") return pushToCloud(request);
  if (mode === "resolve") return resolveConflict(request);
  throw new Response("mode must be pull, push, or resolve", { status: 400 });
}

export function loader() {
  return new Response("Method not allowed", { status: 405 });
}
