import { maxBytesForType, type TabContentType } from "./limits";

export const MAX_TABS = 20;
const TAB_CONTENT_TYPES = new Set<TabContentType>(["html", "markdown", "pdf", "doc"]);

export type SubmittedTab = {
  id?: string;
  slug?: string;
  name: string;
  position: number;
  html?: string;
  content_type?: TabContentType;
  _delete?: true;
};

function reject(message: string, status = 400): never {
  throw new Response(message, { status });
}

export function validateSaveTitle(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 500) {
    reject("Invalid document title");
  }
  return value;
}

export function validateSaveTabs(value: unknown): SubmittedTab[] {
  if (!Array.isArray(value)) reject("tabs must be an array");

  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();
  const tabs: SubmittedTab[] = [];

  for (const rawTab of value) {
    if (!rawTab || typeof rawTab !== "object" || Array.isArray(rawTab)) {
      reject("Invalid tab");
    }

    const tab = rawTab as Record<string, unknown>;
    const id = tab.id === undefined ? undefined : tab.id;
    if (id !== undefined && (typeof id !== "string" || !/^(?:new:[A-Za-z0-9-]{1,64}|[A-Za-z0-9_-]{1,64})$/.test(id))) {
      reject("Invalid tab id");
    }
    if (id && seenIds.has(id)) reject("Duplicate tab id");
    if (id) seenIds.add(id);

    if (tab._delete === true) {
      if (!id) reject("Deleted tab id is required");
      tabs.push({ id, name: "", position: 0, _delete: true });
      continue;
    }
    if (tab._delete !== undefined && tab._delete !== false) {
      reject("Invalid tab delete marker");
    }

    const name = tab.name;
    if (typeof name !== "string" || name.length > 200) reject("Invalid tab name");

    const position = tab.position;
    if (typeof position !== "number" || !Number.isInteger(position) || position < 0) {
      reject("Invalid tab position");
    }

    const html = tab.html;
    if (typeof html !== "string") reject("Tab content is required");

    const contentType = tab.content_type ?? "html";
    if (typeof contentType !== "string" || !TAB_CONTENT_TYPES.has(contentType as TabContentType)) {
      reject("Invalid tab content type");
    }
    if (new TextEncoder().encode(html).length > maxBytesForType(contentType as TabContentType)) {
      reject("Tab exceeds its content limit", 413);
    }

    const slug = tab.slug;
    if (slug !== undefined) {
      if (typeof slug !== "string" || slug.length > 200) reject("Invalid tab slug");
      if (slug) {
        if (seenSlugs.has(slug)) reject("Duplicate tab slug");
        seenSlugs.add(slug);
      }
    }

    tabs.push({
      ...(id ? { id } : {}),
      ...(typeof slug === "string" ? { slug } : {}),
      name,
      position,
      html,
      content_type: contentType as TabContentType,
    });
  }

  const activeTabs = tabs.filter((tab) => !tab._delete);
  if (activeTabs.length > MAX_TABS) reject("Too many tabs");
  if (activeTabs.length === 0) reject("A document must contain at least one tab");
  return tabs;
}

export class AgentWriteError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AgentWriteError";
    this.status = status;
  }
}

/** Agent tool arguments surface failures as tool errors, not HTTP responses. */
function rejectWrite(message: string, status = 400): never {
  throw new AgentWriteError(message, status);
}

export function validateContentType(value: unknown): TabContentType {
  if (value === undefined || value === null) return "html";
  if (typeof value !== "string" || !TAB_CONTENT_TYPES.has(value as TabContentType)) {
    rejectWrite("Invalid tab content type");
  }
  return value as TabContentType;
}

export function validateTabContent(value: unknown, contentType: TabContentType): string {
  if (typeof value !== "string") rejectWrite("Tab content is required");
  if (new TextEncoder().encode(value).length > maxBytesForType(contentType)) {
    rejectWrite("Tab exceeds its content limit", 413);
  }
  return value;
}

export function validateTabName(value: unknown, fallback = "Untitled"): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") rejectWrite("Invalid tab name");
  return value.slice(0, 200) || fallback;
}

/** Validates the `baseRevision` argument shared by every mutating tool call. */
export function validateBaseRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    rejectWrite(
      "baseRevision is required so agent writes never overwrite newer edits. Read the document first and pass its current revision.",
      428,
    );
  }
  return value as number;
}

export interface AgentTabInput {
  name: string;
  content: string;
  contentType: TabContentType;
}

/** Validates the `tabs` argument of a document-creation tool call. */
export function validateNewDocumentTabs(value: unknown): AgentTabInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    rejectWrite("tabs must be a non-empty array");
  }
  if (value.length > MAX_TABS) rejectWrite("Too many tabs");

  return value.map((rawTab) => {
    if (!rawTab || typeof rawTab !== "object" || Array.isArray(rawTab)) {
      rejectWrite("Invalid tab");
    }
    const tab = rawTab as Record<string, unknown>;
    const contentType = validateContentType(tab.contentType);
    return {
      name: validateTabName(tab.name, "Untitled"),
      content: validateTabContent(tab.content, contentType),
      contentType,
    };
  });
}
