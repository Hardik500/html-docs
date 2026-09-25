import { withTransaction, query, type QueryRunner } from "./db.server";
import { newDocId, newEditToken, newTabId } from "./ids";
import { dedupeSlug, slugify } from "./slug";
import { recordDocumentChange } from "./sync.server";
import { extractTitle, extractMarkdownTitle } from "./titleExtract";
import { maxBytesForType } from "./limits";
import {
  AgentWriteError,
  validateBaseRevision,
  validateContentType,
  validateNewDocumentTabs,
  validateTabContent,
  validateTabName,
  type AgentTabInput,
  type SubmittedTab,
} from "./document-input";

export interface DocumentSummary {
  id: string;
  title: string;
  revision: number;
  tabCount: number;
  contentTypes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DocumentTab {
  id: string;
  slug: string;
  name: string;
  position: number;
  contentType: string;
  content?: string;
}

export interface DocumentDetail extends DocumentSummary {
  tabs: DocumentTab[];
}

export interface ListDocumentsOptions {
  limit?: number;
  offset?: number;
  search?: string;
}

export async function listUserDocuments(
  userId: string,
  options: ListDocumentsOptions = {},
): Promise<{ documents: DocumentSummary[]; nextOffset: number | null }> {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const offset = Math.max(0, options.offset ?? 0);
  const search = options.search?.trim().slice(0, 200) || null;
  const result = await query<{
    id: string;
    title: string;
    revision: string | number;
    tab_count: string | number;
    content_types: string[] | null;
    created_at: string;
    last_activity_at: string;
  }>(
    `SELECT d.id,
            d.title,
            d.revision,
            COUNT(t.id)::int AS tab_count,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT t.content_type), NULL) AS content_types,
            d.created_at,
            d.last_activity_at
       FROM docs d
       LEFT JOIN tabs t ON t.doc_id = d.id
      WHERE d.owner_user_id = $1
        AND d.deleted_at IS NULL
        AND ($2::text IS NULL OR d.title ILIKE $2)
      GROUP BY d.id
      ORDER BY d.last_activity_at DESC, d.id DESC
      LIMIT $3 OFFSET $4`,
    [userId, search ? `%${search}%` : null, limit, offset],
  );

  const documents = result.rows.map(toDocumentSummary);
  return {
    documents,
    nextOffset: documents.length === limit ? offset + limit : null,
  };
}

export async function getUserDocument(
  userId: string,
  documentId: string,
  includeContent = false,
): Promise<DocumentDetail | null> {
  const result = await query<{
    id: string;
    title: string;
    revision: string | number;
    created_at: string;
    last_activity_at: string;
  }>(
    `SELECT id, title, revision, created_at, last_activity_at
       FROM docs
      WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
    [documentId, userId],
  );
  const doc = result.rows[0];
  if (!doc) return null;

  const tabs = await query<{
    id: string;
    slug: string;
    name: string;
    position: number;
    content_type: string;
    html: string;
  }>(
    `SELECT id, slug, name, position, content_type, html
       FROM tabs
      WHERE doc_id = $1
      ORDER BY position ASC`,
    [documentId],
  );

  return {
    id: doc.id,
    title: doc.title,
    revision: Number(doc.revision),
    tabCount: tabs.rows.length,
    contentTypes: [...new Set(tabs.rows.map((tab) => tab.content_type))],
    createdAt: doc.created_at,
    updatedAt: doc.last_activity_at,
    tabs: tabs.rows.map((tab) => ({
      id: tab.id,
      slug: tab.slug,
      name: tab.name,
      position: tab.position,
      contentType: tab.content_type,
      ...(includeContent ? { content: tab.html } : {}),
    })),
  };
}

export async function getUserDocumentTab(
  userId: string,
  documentId: string,
  tabSlug: string,
): Promise<(DocumentTab & { documentId: string; documentTitle: string; revision: number }) | null> {
  const result = await query<{
    id: string;
    slug: string;
    name: string;
    position: number;
    content_type: string;
    html: string;
    document_id: string;
    document_title: string;
    revision: string | number;
  }>(
    `SELECT t.id, t.slug, t.name, t.position, t.content_type, t.html,
            d.id AS document_id, d.title AS document_title, d.revision
       FROM tabs t
       JOIN docs d ON d.id = t.doc_id
      WHERE t.doc_id = $1
        AND t.slug = $2
        AND d.owner_user_id = $3
        AND d.deleted_at IS NULL`,
    [documentId, tabSlug, userId],
  );
  const tab = result.rows[0];
  if (!tab) return null;
  return {
    id: tab.id,
    slug: tab.slug,
    name: tab.name,
    position: tab.position,
    contentType: tab.content_type,
    content: tab.html,
    documentId: tab.document_id,
    documentTitle: tab.document_title,
    revision: Number(tab.revision),
  };
}

// ── Agent write operations ───────────────────────────────────────────────────

export interface WriteOutcome {
  id: string;
  title: string;
  revision: number;
  tabs: Array<Pick<DocumentTab, "id" | "slug" | "name" | "position" | "contentType">>;
}

/** Locks the document row and asserts ownership plus the expected revision. */
async function lockOwnedDocument(
  runQuery: QueryRunner,
  userId: string,
  documentId: string,
  baseRevision: number | null,
): Promise<{ title: string; revision: number }> {
  const current = await runQuery<{ title: string; revision: string | number }>(
    `SELECT title, revision
       FROM docs
      WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL
      FOR UPDATE`,
    [documentId, userId],
  );
  if (!current.rows.length) {
    throw new AgentWriteError(`Document ${documentId} was not found`, 404);
  }
  const revision = Number(current.rows[0].revision);
  if (baseRevision !== null && revision !== baseRevision) {
    throw new AgentWriteError(
      `Revision conflict: the document is now at revision ${revision}, not ${baseRevision}. Read it again before writing.`,
      409,
    );
  }
  return { title: current.rows[0].title, revision };
}

export async function createUserDocument(
  userId: string,
  input: { title?: string; tabs: unknown },
): Promise<WriteOutcome> {
  const tabs = validateNewDocumentTabs(input.tabs);
  const title = (typeof input.title === "string" ? input.title.trim() : "")
    .slice(0, 500)
    || tabs[0].name
    || "Untitled";

  return withTransaction(async (runQuery) => {
    const documentId = newDocId();
    await runQuery(
      `INSERT INTO docs (id, title, owner_user_id, edit_token)
       VALUES ($1, $2, $3, $4)`,
      [documentId, title, userId, newEditToken()],
    );

    const usedSlugs = new Set<string>();
    const createdTabs: WriteOutcome["tabs"] = [];
    for (const [position, tab] of tabs.entries()) {
      const slug = dedupeSlug(slugify(tab.name), usedSlugs);
      usedSlugs.add(slug);
      const id = newTabId();
      await runQuery(
        `INSERT INTO tabs (id, doc_id, slug, name, position, html, content_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, documentId, slug, tab.name, position, tab.content, tab.contentType],
      );
      createdTabs.push({ id, slug, name: tab.name, position, contentType: tab.contentType });
    }

    const revision = (await recordDocumentChange(runQuery, documentId, userId)) ?? 1;
    return { id: documentId, title, revision, tabs: createdTabs };
  });
}

export async function updateUserDocument(
  userId: string,
  documentId: string,
  input: { title?: string; tabs: SubmittedTab[]; baseRevision: number },
): Promise<WriteOutcome> {
  const baseRevision = validateBaseRevision(input.baseRevision);

  return withTransaction(async (runQuery) => {
    const { title: currentTitle, revision: currentRevision } = await lockOwnedDocument(
      runQuery,
      userId,
      documentId,
      baseRevision,
    );

    if (input.title !== undefined) {
      await runQuery(
        "UPDATE docs SET title = $1 WHERE id = $2",
        [input.title.slice(0, 500), documentId],
      );
    }

    const existing = await runQuery<{ id: string; slug: string }>(
      "SELECT id, slug FROM tabs WHERE doc_id = $1",
      [documentId],
    );
    const slugById = new Map(existing.rows.map((row) => [row.id, row.slug]));
    const usedSlugs = new Set(slugById.values());
    const createdTabs: Array<{ id: string; slug: string; name: string }> = [];

    for (const tab of input.tabs) {
      if (tab._delete && tab.id) {
        await runQuery("DELETE FROM tabs WHERE id = $1 AND doc_id = $2", [tab.id, documentId]);
        slugById.delete(tab.id);
        usedSlugs.delete(slugById.get(tab.id) ?? "");
        continue;
      }

      const contentType = validateContentType(tab.content_type);
      const isNew = !tab.id || tab.id.startsWith("new:");
      if (isNew) {
        const id = newTabId();
        const name = tab.name || "New Tab";
        const slug = dedupeSlug(slugify(name), usedSlugs);
        usedSlugs.add(slug);
        slugById.set(id, slug);
        await runQuery(
          `INSERT INTO tabs (id, doc_id, slug, name, position, html, content_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, documentId, slug, name, tab.position, tab.html ?? "", contentType],
        );
        createdTabs.push({ id, slug, name });
        continue;
      }

      const tabId = tab.id;
      if (typeof tabId !== "string" || !slugById.has(tabId)) {
        throw new AgentWriteError(
          `Tab ${tabId ?? "(none)"} does not belong to document ${documentId}`,
          404,
        );
      }
      const html = tab.html ?? "";
      if (new TextEncoder().encode(html).length > maxBytesForType(contentType)) {
        throw new AgentWriteError("Tab exceeds its content limit", 413);
      }
      const name = tab.name || deriveTabName(html, contentType);
      await runQuery(
        `UPDATE tabs
            SET name = $1, position = $2, html = $3, content_type = $4,
                updated_at = now(), version = version + 1
          WHERE id = $5 AND doc_id = $6`,
        [name.slice(0, 200), tab.position, html, contentType, tabId, documentId],
      );
    }

    const revision = (await recordDocumentChange(runQuery, documentId, userId)) ?? currentRevision;
    const finalTitle = input.title !== undefined ? input.title.slice(0, 500) : currentTitle;
    const detail = await readDocumentInTransaction(runQuery, userId, documentId);

    return {
      id: documentId,
      title: finalTitle,
      revision,
      tabs: detail?.tabs.map(({ id, slug, name, position, contentType }) => ({
        id,
        slug,
        name,
        position,
        contentType,
      })) ?? [],
      createdTabs,
    } as WriteOutcome & { createdTabs: typeof createdTabs };
  });
}

export async function updateUserDocumentTab(
  userId: string,
  documentId: string,
  tabSlug: string,
  input: { name?: string; content?: string; contentType?: string; baseRevision: number },
): Promise<WriteOutcome> {
  const baseRevision = validateBaseRevision(input.baseRevision);

  return withTransaction(async (runQuery) => {
    const { revision: currentRevision } = await lockOwnedDocument(
      runQuery,
      userId,
      documentId,
      baseRevision,
    );

    const existing = await runQuery<{
      id: string;
      slug: string;
      name: string;
      position: string | number;
      content_type: string;
      html: string;
    }>(
      `SELECT id, slug, name, position, content_type, html
         FROM tabs
        WHERE doc_id = $1 AND slug = $2`,
      [documentId, tabSlug],
    );
    if (!existing.rows.length) {
      throw new AgentWriteError(`Tab ${tabSlug} was not found in document ${documentId}`, 404);
    }
    const tab = existing.rows[0];
    const contentType = input.contentType === undefined
      ? (tab.content_type as "html" | "markdown" | "pdf" | "doc")
      : validateContentType(input.contentType);
    const content = input.content === undefined ? tab.html : input.content;
    validateTabContent(content, contentType);
    const name = validateTabName(input.name, tab.name);

    await runQuery(
      `UPDATE tabs
          SET name = $1, html = $2, content_type = $3, updated_at = now(), version = version + 1
        WHERE id = $4 AND doc_id = $5`,
      [name, content, contentType, tab.id, documentId],
    );

    const revision = (await recordDocumentChange(runQuery, documentId, userId)) ?? currentRevision;
    const detail = await readDocumentInTransaction(runQuery, userId, documentId);
    if (!detail) throw new AgentWriteError(`Document ${documentId} was not found`, 404);

    return {
      id: detail.id,
      title: detail.title,
      revision,
      tabs: detail.tabs.map(({ id, slug, name, position, contentType }) => ({
        id,
        slug,
        name,
        position,
        contentType,
      })),
    };
  });
}

export async function deleteUserDocument(
  userId: string,
  documentId: string,
  input: { baseRevision?: number } = {},
): Promise<{ id: string; deleted: true; revision: number }> {
  const baseRevision = input.baseRevision === undefined ? null : validateBaseRevision(input.baseRevision);

  return withTransaction(async (runQuery) => {
    const { revision: currentRevision } = await lockOwnedDocument(
      runQuery,
      userId,
      documentId,
      baseRevision,
    );
    await runQuery(
      "UPDATE docs SET deleted_at = now(), last_activity_at = now() WHERE id = $1",
      [documentId],
    );
    await runQuery("DELETE FROM tabs WHERE doc_id = $1", [documentId]);
    const revision = (await recordDocumentChange(runQuery, documentId, userId)) ?? currentRevision;
    return { id: documentId, deleted: true as const, revision };
  });
}

function deriveTabName(html: string, contentType: string): string {
  if (contentType === "markdown") return extractMarkdownTitle(html, "Tab");
  if (contentType === "pdf") return "PDF";
  return extractTitle(html, "Tab");
}

/** Reads a document using an existing transaction runner. */
async function readDocumentInTransaction(
  runQuery: QueryRunner,
  userId: string,
  documentId: string,
): Promise<DocumentDetail | null> {
  const doc = await runQuery<{
    id: string;
    title: string;
    revision: string | number;
    created_at: string;
    last_activity_at: string;
  }>(
    `SELECT id, title, revision, created_at, last_activity_at
       FROM docs
      WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
    [documentId, userId],
  );
  if (!doc.rows.length) return null;

  const tabs = await runQuery<{
    id: string;
    slug: string;
    name: string;
    position: string | number;
    content_type: string;
  }>(
    `SELECT id, slug, name, position, content_type
       FROM tabs
      WHERE doc_id = $1
      ORDER BY position ASC`,
    [documentId],
  );

  return {
    id: doc.rows[0].id,
    title: doc.rows[0].title,
    revision: Number(doc.rows[0].revision),
    tabCount: tabs.rows.length,
    contentTypes: [...new Set(tabs.rows.map((tab) => tab.content_type))],
    createdAt: doc.rows[0].created_at,
    updatedAt: doc.rows[0].last_activity_at,
    tabs: tabs.rows.map((tab) => ({
      id: tab.id,
      slug: tab.slug,
      name: tab.name,
      position: Number(tab.position),
      contentType: tab.content_type,
    })),
  };
}

function toDocumentSummary(row: {
  id: string;
  title: string;
  revision: string | number;
  tab_count: string | number;
  content_types: string[] | null;
  created_at: string;
  last_activity_at: string;
}): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    revision: Number(row.revision),
    tabCount: Number(row.tab_count),
    contentTypes: row.content_types ?? [],
    createdAt: row.created_at,
    updatedAt: row.last_activity_at,
  };
}
