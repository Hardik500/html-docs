import type { Route } from "./+types/sync.push";
import { getUser } from "~/lib/auth.server";
import { newEditToken } from "~/lib/ids";
import { withTransaction, type QueryRunner } from "~/lib/db.server";
import { isDesktopRuntime } from "~/lib/runtime.server";
import { maxBytesForType, type TabContentType } from "~/lib/limits";
import { checkSyncPushRate } from "~/lib/ratelimit.server";
import type { PushRequest, PushResponse, SyncTab } from "~/lib/sync.server";

const MAX_TABS = 20;
const MAX_BODY_BYTES = 4_000_000;
const encoder = new TextEncoder();

async function readJsonBody(request: Request): Promise<unknown> {
  const body = request.body;
  if (!body) throw new Response("JSON body is required", { status: 400 });

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Response("Payload too large", { status: 413 });
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Response("Invalid JSON body", { status: 400 });
  }
}

interface ExistingDoc {
  owner_user_id: string | null;
  revision: string | number;
  deleted_at: string | Date | null;
  edit_token: string;
}

type TransactionResult =
  | { kind: "ok"; response: PushResponse }
  | { kind: "conflict"; remoteRevision: number }
  | { kind: "forbidden" }
  | { kind: "not-found" };

function contentType(value: unknown): TabContentType {
  return value === "markdown" || value === "pdf" || value === "doc"
    ? value
    : "html";
}

function validateDocument(body: unknown): PushRequest["document"] {
  if (!body || typeof body !== "object") {
    throw new Response("Invalid sync document", { status: 400 });
  }

  const document = (body as { document?: unknown }).document;
  if (!document || typeof document !== "object") {
    throw new Response("document is required", { status: 400 });
  }

  const value = document as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const baseRevision = Number(value.baseRevision);
  const tabs = Array.isArray(value.tabs) ? value.tabs : [];

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    throw new Response("Invalid document id", { status: 400 });
  }
  if (!title || title.length > 500) {
    throw new Response("Invalid document title", { status: 400 });
  }
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw new Response("Invalid base revision", { status: 400 });
  }
  if (tabs.length > MAX_TABS) {
    throw new Response("Too many tabs", { status: 400 });
  }

  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();
  const normalizedTabs: SyncTab[] = tabs.map((rawTab) => {
    if (!rawTab || typeof rawTab !== "object") {
      throw new Response("Invalid tab", { status: 400 });
    }
    const tab = rawTab as Record<string, unknown>;
    const tabId = typeof tab.id === "string" ? tab.id : "";
    const slug = typeof tab.slug === "string" ? tab.slug : "";
    const name = typeof tab.name === "string" ? tab.name : "";
    const position = Number(tab.position);
    const html = typeof tab.html === "string" ? tab.html : "";
    const type = contentType(tab.content_type);

    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tabId) || seenIds.has(tabId)) {
      throw new Response("Invalid or duplicate tab id", { status: 400 });
    }
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(slug) || seenSlugs.has(slug)) {
      throw new Response("Invalid or duplicate tab slug", { status: 400 });
    }
    if (!name || name.length > 200 || !Number.isInteger(position) || position < 0) {
      throw new Response("Invalid tab metadata", { status: 400 });
    }
    if (encoder.encode(html).length > maxBytesForType(type)) {
      throw new Response("Tab exceeds its content limit", { status: 413 });
    }

    seenIds.add(tabId);
    seenSlugs.add(slug);
    return {
      id: tabId,
      slug,
      name,
      position,
      html,
      content_type: type,
    };
  });

  return {
    id,
    title,
    baseRevision,
    deleted: value.deleted === true,
    force: value.force === true,
    tabs: normalizedTabs,
  };
}

async function writeDocument(
  runQuery: QueryRunner,
  userId: string,
  document: PushRequest["document"],
): Promise<TransactionResult> {
  const existing = await runQuery<ExistingDoc>(
    `SELECT owner_user_id, revision, deleted_at, edit_token
       FROM docs
      WHERE id = $1
      FOR UPDATE`,
    [document.id],
  );

  if (!existing.rows.length) {
    if (document.baseRevision !== 0 || document.deleted) {
      return { kind: "not-found" };
    }

    const editToken = newEditToken();
    await runQuery(
      `INSERT INTO docs (id, title, owner_user_id, edit_token, revision)
       VALUES ($1, $2, $3, $4, 1)`,
      [document.id, document.title, userId, editToken],
    );
    for (const tab of document.tabs) {
      await runQuery(
        `INSERT INTO tabs (id, doc_id, slug, name, position, html, content_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tab.id,
          document.id,
          tab.slug,
          tab.name,
          tab.position,
          tab.html,
          tab.content_type,
        ],
      );
    }
    await runQuery(
      `INSERT INTO sync_changes (doc_id, owner_user_id, revision)
       VALUES ($1, $2, 1)`,
      [document.id, userId],
    );
    return {
      kind: "ok",
      response: { id: document.id, revision: 1, deleted: false, editToken },
    };
  }

  const current = existing.rows[0];
  if (current.owner_user_id !== userId) return { kind: "forbidden" };

  const remoteRevision = Number(current.revision);
  if (!document.force && remoteRevision !== document.baseRevision) {
    return { kind: "conflict", remoteRevision };
  }

  if (document.deleted) {
    await runQuery(
      `UPDATE docs
          SET deleted_at = now(), revision = revision + 1, last_activity_at = now()
        WHERE id = $1`,
      [document.id],
    );
    await runQuery("DELETE FROM tabs WHERE doc_id = $1", [document.id]);
  } else {
    await runQuery(
      `UPDATE docs
          SET title = $1, deleted_at = NULL, revision = revision + 1,
              last_activity_at = now()
        WHERE id = $2`,
      [document.title, document.id],
    );
    await runQuery("DELETE FROM tabs WHERE doc_id = $1", [document.id]);
    for (const tab of document.tabs) {
      await runQuery(
        `INSERT INTO tabs (id, doc_id, slug, name, position, html, content_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tab.id,
          document.id,
          tab.slug,
          tab.name,
          tab.position,
          tab.html,
          tab.content_type,
        ],
      );
    }
  }

  const nextRevision = remoteRevision + 1;
  await runQuery(
    `INSERT INTO sync_changes (doc_id, owner_user_id, revision)
     VALUES ($1, $2, $3)`,
    [document.id, userId, nextRevision],
  );
  return {
    kind: "ok",
    response: {
      id: document.id,
      revision: nextRevision,
      deleted: document.deleted === true,
      editToken: current.edit_token,
    },
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (isDesktopRuntime()) {
    throw new Response("Hosted sync is not available from the local runtime", {
      status: 501,
    });
  }
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    throw new Response("Payload too large", { status: 413 });
  }

  const user = await getUser(request);
  if (!user) throw new Response("Unauthorized", { status: 401 });

  const document = validateDocument(await readJsonBody(request));
  const allowed = await checkSyncPushRate(user.id, document.id);
  if (!allowed) {
    throw new Response("Too many sync requests. Please slow down.", {
      status: 429,
    });
  }

  const result = await withTransaction((runQuery) =>
    writeDocument(runQuery, user.id, document),
  );

  if (result.kind === "conflict") {
    return Response.json(
      { error: "conflict", remoteRevision: result.remoteRevision },
      { status: 409 },
    );
  }
  if (result.kind === "forbidden") {
    throw new Response("Forbidden", { status: 403 });
  }
  if (result.kind === "not-found") {
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  return Response.json(result.response, {
    headers: { "Cache-Control": "no-store" },
  });
}
