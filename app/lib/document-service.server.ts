import { query } from "./db.server";

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
