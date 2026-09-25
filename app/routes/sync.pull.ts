import type { Route } from "./+types/sync.pull";
import { getUser } from "~/lib/auth.server";
import { query } from "~/lib/db.server";
import { isDesktopRuntime } from "~/lib/runtime.server";
import {
  parseSyncCursor,
  toSyncDocument,
  toSyncTab,
  type PullResponse,
} from "~/lib/sync.server";

const PAGE_SIZE = 100;
const MAX_DOCUMENTS_PER_PAGE = 20;
const MAX_SYNC_RESPONSE_BYTES = 8 * 1024 * 1024;

interface ChangeRow {
  seq: string | number;
  doc_id: string;
}

export async function loader({ request }: Route.LoaderArgs) {
  if (isDesktopRuntime()) {
    throw new Response("Hosted sync is not available from the local runtime", {
      status: 501,
    });
  }

  const user = await getUser(request);
  if (!user) throw new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const cursor = parseSyncCursor(url.searchParams.get("cursor"));
  const changes = await query<ChangeRow>(
    `SELECT seq, doc_id
       FROM sync_changes
      WHERE owner_user_id = $1 AND seq > $2
      ORDER BY seq ASC
      LIMIT $3`,
    [user.id, cursor, PAGE_SIZE + 1],
  );

  const hasMore = changes.rows.length > PAGE_SIZE;
  const page = changes.rows.slice(0, PAGE_SIZE);
  if (!page.length) {
    return Response.json(
      { cursor, hasMore, documents: [] } satisfies PullResponse,
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Bound the number of unique documents before loading their content. The
  // cursor stops at the first change for the next document so no change is
  // skipped when one account has many documents between pulls.
  const docIds: string[] = [];
  const seenDocIds = new Set<string>();
  let consumedChanges = 0;
  for (const change of page) {
    if (!seenDocIds.has(change.doc_id)) {
      if (docIds.length >= MAX_DOCUMENTS_PER_PAGE) break;
      seenDocIds.add(change.doc_id);
      docIds.push(change.doc_id);
    }
    consumedChanges += 1;
  }

  const nextCursor = Number(page[consumedChanges - 1].seq);
  const docs = await query<{
    id: string;
    title: string;
    revision: string | number;
    deleted_at: string | Date | null;
    edit_token: string;
  }>(
    `SELECT id, title, revision, deleted_at, edit_token
       FROM docs
      WHERE owner_user_id = $1 AND id = ANY($2::text[])`,
    [user.id, docIds],
  );

  const tabStats = await query<{ doc_id: string; bytes: string | number }>(
    `SELECT doc_id, SUM(octet_length(html)) AS bytes
       FROM tabs
      WHERE doc_id = ANY($1::text[])
      GROUP BY doc_id`,
    [docIds],
  );
  const totalBytes = tabStats.rows.reduce(
    (sum, row) => sum + Number(row.bytes),
    0,
  );
  if (totalBytes > MAX_SYNC_RESPONSE_BYTES) {
    return Response.json(
      { error: "sync-page-too-large", maxBytes: MAX_SYNC_RESPONSE_BYTES },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }

  const tabs = await query<{
    id: string;
    doc_id: string;
    slug: string;
    name: string;
    position: number;
    html: string;
    content_type: string;
  }>(
    `SELECT id, doc_id, slug, name, position, html, content_type
       FROM tabs
      WHERE doc_id = ANY($1::text[])
      ORDER BY doc_id, position ASC`,
    [docIds],
  );

  const tabsByDoc = new Map<string, ReturnType<typeof toSyncTab>[]>();
  for (const tab of tabs.rows) {
    const list = tabsByDoc.get(tab.doc_id) ?? [];
    list.push(toSyncTab(tab));
    tabsByDoc.set(tab.doc_id, list);
  }

  const docsById = new Map(
    docs.rows.map((doc) => [doc.id, toSyncDocument(doc)]),
  );
  const documents = docIds.map((id) => {
    const doc = docsById.get(id);
    if (!doc) {
      // A hard-deleted legacy row may not have a current docs record. The
      // event itself is still enough to tell clients to remove it.
      return {
        id,
        title: "",
        revision: 0,
        deleted: true,
        tabs: [],
      };
    }
    doc.tabs = tabsByDoc.get(id) ?? [];
    return doc;
  });

  return Response.json(
    {
      cursor: nextCursor,
      hasMore: hasMore || consumedChanges < page.length,
      documents,
    } satisfies PullResponse,
    { headers: { "Cache-Control": "no-store" } },
  );
}
