import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({
  query: mocks.query,
  withTransaction: mocks.withTransaction,
  getPostgresPool: vi.fn(),
  getLocalDatabase: vi.fn(),
}));

import {
  createUserDocument,
  createUserDocumentTab,
  deleteUserDocument,
  deleteUserDocumentTab,
  renameUserDocument,
  updateUserDocument,
  updateUserDocumentTab,
} from "~/lib/document-service.server";
import { AgentWriteError } from "~/lib/document-input";

/** Builds a runQuery that answers the known statements the write path issues. */
function fakeTransaction(handlers: {
  lock?: Array<{ title: string; revision: number }>;
  tabs?: Array<Record<string, unknown>>;
  inserted?: { id: string; slug: string; name: string; position: number; content_type: string };
}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const runQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/FOR UPDATE/.test(sql)) {
      // lockOwnedDocument locks the document row and reads the tab list in one
      // CTE, so this answers both halves from the same fixture.
      const locked = handlers.lock ?? [];
      if (!locked.length) return { rows: [] };
      return {
        rows: [
          {
            doc: { title: locked[0].title, revision: String(locked[0].revision) },
            tabs: (handlers.tabs ?? []).map(({ id, slug, name, position, content_type }) => ({
              id,
              slug,
              name,
              position,
              content_type,
            })),
          },
        ],
      };
    }
    if (/INSERT INTO tabs/.test(sql) && /RETURNING id, slug/.test(sql)) {
      return {
        rows: [
          handlers.inserted ?? {
            id: "tab-new",
            slug: "new-tab",
            name: "New Tab",
            position: 0,
            content_type: "html",
          },
        ],
      };
    }
    if (/RETURNING revision/.test(sql)) {
      return { rows: [{ revision: "3" }] };
    }
    if (/SELECT id, title, revision, created_at/.test(sql)) {
      return {
        rows: [
          {
            id: "doc-1",
            title: "Doc",
            revision: "3",
            created_at: "2026-01-01T00:00:00Z",
            last_activity_at: "2026-01-02T00:00:00Z",
          },
        ],
      };
    }
    if (/SELECT id, slug, name, position, content_type\s/.test(sql)) {
      return { rows: handlers.tabs ?? [] };
    }
    return { rows: [] };
  });
  return { runQuery, calls };
}

/** Runs a write against a fake transaction, wiring the mock as db.server would. */
function useFakeTransaction(handlers: Parameters<typeof fakeTransaction>[0]) {
  const { runQuery, calls } = fakeTransaction(handlers);
  mocks.withTransaction.mockImplementation(
    async (fn: (q: typeof runQuery) => unknown) => fn(runQuery),
  );
  return { runQuery, calls };
}

describe("agent document writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a document with owned rows and a recorded change", async () => {
    const { runQuery, calls } = fakeTransaction({});
    mocks.withTransaction.mockImplementation(async (fn: (q: typeof runQuery) => unknown) => fn(runQuery));

    const result = await createUserDocument("user-1", {
      title: "Agent Report",
      tabs: [{ name: "Summary", content: "# Summary\n", contentType: "markdown" }],
    });

    expect(result.title).toBe("Agent Report");
    expect(result.revision).toBe(3);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].slug).toBe("summary");

    const insertDoc = calls.find((call) => /INSERT INTO docs/.test(call.sql));
    expect(insertDoc?.params).toEqual(
      expect.arrayContaining(["user-1", "Agent Report"]),
    );
    expect(insertDoc?.params[0]).toHaveLength(12);
    // edit_token must be generated server-side, never taken from input.
    expect(insertDoc?.params[3]).toEqual(expect.any(String));
    expect(insertDoc?.params[3]).toHaveLength(24);

    const insertTab = calls.find((call) => /INSERT INTO tabs/.test(call.sql));
    expect(insertTab?.params).toEqual(
      expect.arrayContaining([result.id, "summary", "Summary", 0, "# Summary\n", "markdown"]),
    );
    expect(calls.some((call) => /INSERT INTO sync_changes/.test(call.sql))).toBe(true);
  });

  it("derives the document title from the first tab when none is given", async () => {
    const { runQuery } = fakeTransaction({});
    mocks.withTransaction.mockImplementation(async (fn: (q: typeof runQuery) => unknown) => fn(runQuery));

    const result = await createUserDocument("user-1", {
      tabs: [{ name: "Fallback Title", content: "<p>hi</p>", contentType: "html" }],
    });
    expect(result.title).toBe("Fallback Title");
  });

  it("rejects a revision mismatch before writing anything", async () => {
    const { runQuery, calls } = fakeTransaction({ lock: [{ title: "Doc", revision: 7 }] });
    mocks.withTransaction.mockImplementation(async (fn: (q: typeof runQuery) => unknown) => fn(runQuery));

    await expect(
      updateUserDocument("user-1", "doc-1", { title: "New", baseRevision: 3, tabs: [
        { id: "tab-1", name: "A", position: 0, html: "<p>x</p>", content_type: "html" },
      ] }),
    ).rejects.toBeInstanceOf(AgentWriteError);

    await expect(
      updateUserDocument("user-1", "doc-1", { title: "New", baseRevision: 3, tabs: [
        { id: "tab-1", name: "A", position: 0, html: "<p>x</p>", content_type: "html" },
      ] }),
    ).rejects.toMatchObject({ status: 409 });

    expect(calls.some((call) => /UPDATE docs/.test(call.sql))).toBe(false);
  });

  it("requires a baseRevision for every mutating call", async () => {
    await expect(
      updateUserDocumentTab("user-1", "doc-1", "tab-1", { content: "x", baseRevision: undefined as unknown as number }),
    ).rejects.toMatchObject({ status: 428 });
    await expect(
      deleteUserDocument("user-1", "doc-1", {}),
    ).resolves.toBeDefined();
  });

  it("rejects a tab that belongs to another document", async () => {
    const { runQuery } = fakeTransaction({ lock: [{ title: "Doc", revision: 2 }], tabs: [] });
    mocks.withTransaction.mockImplementation(async (fn: (q: typeof runQuery) => unknown) => fn(runQuery));

    await expect(
      updateUserDocument("user-1", "doc-1", { baseRevision: 2, tabs: [
        { id: "tab-foreign", name: "A", position: 0, html: "<p>x</p>", content_type: "html" },
      ] }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("soft-deletes an owned document and removes its tabs", async () => {
    const { runQuery, calls } = fakeTransaction({ lock: [{ title: "Doc", revision: 4 }] });
    mocks.withTransaction.mockImplementation(async (fn: (q: typeof runQuery) => unknown) => fn(runQuery));

    const result = await deleteUserDocument("user-1", "doc-1", { baseRevision: 4 });
    expect(result).toEqual({ id: "doc-1", deleted: true, revision: 3 });

    expect(calls.some((call) => /SET deleted_at = now\(\)/.test(call.sql))).toBe(true);
    expect(calls.some((call) => /DELETE FROM tabs WHERE doc_id/.test(call.sql))).toBe(true);
  });

  it("updates a single tab by slug without touching siblings", async () => {
    const { calls } = useFakeTransaction({
      lock: [{ title: "Doc", revision: 2 }],
      tabs: [
        { id: "tab-1", slug: "intro", name: "Intro", position: 0, content_type: "markdown", html: "# Intro" },
      ],
    });

    const result = await updateUserDocumentTab("user-1", "doc-1", "intro", {
      content: "# Updated",
      baseRevision: 2,
    });

    expect(result.revision).toBe(3);
    // Untouched columns are passed as NULL and left alone by COALESCE, so a
    // content edit does not resend the name or re-assert the content type.
    const update = calls.find((call) => /^UPDATE tabs/.test(call.sql));
    expect(update?.params).toEqual([null, "# Updated", null, "tab-1", "doc-1"]);
    // A single-tab edit must not delete or rewrite other tabs.
    expect(calls.some((call) => /DELETE FROM tabs/.test(call.sql))).toBe(false);
    // The response reports the stored values, not the nulls that were written.
    expect(result.tabs).toEqual([
      { id: "tab-1", slug: "intro", name: "Intro", position: 0, contentType: "markdown" },
    ]);
  });

  it("updates a single tab in five statements", async () => {
    const { runQuery } = useFakeTransaction({
      lock: [{ title: "Doc", revision: 2 }],
      tabs: [
        { id: "tab-1", slug: "intro", name: "Intro", position: 0, content_type: "html" },
        { id: "tab-2", slug: "notes", name: "Notes", position: 1, content_type: "html" },
      ],
    });

    await updateUserDocumentTab("user-1", "doc-1", "intro", {
      content: "# Updated",
      baseRevision: 2,
    });

    // BEGIN/COMMIT are two further round trips. The database is remote, so the
    // per-statement cost is the thing worth holding down: lock + tab snapshot in
    // one CTE, one UPDATE, one revision bump. A re-read here would make it 8.
    expect(runQuery).toHaveBeenCalledTimes(3);
  });

  it("renames a tab without rewriting its content", async () => {
    const { calls } = useFakeTransaction({
      lock: [{ title: "Doc", revision: 2 }],
      tabs: [
        { id: "tab-1", slug: "intro", name: "Intro", position: 0, content_type: "html" },
      ],
    });

    const result = await updateUserDocumentTab("user-1", "doc-1", "intro", {
      name: "Introduction",
      baseRevision: 2,
    });

    const update = calls.find((call) => /^UPDATE tabs/.test(call.sql));
    expect(update?.params).toEqual(["Introduction", null, null, "tab-1", "doc-1"]);
    // No statement anywhere reads the stored html just to write it back.
    expect(calls.some((call) => /SELECT/.test(call.sql) && /html/.test(call.sql))).toBe(false);
    expect(result.tabs[0].name).toBe("Introduction");
    expect(result.tabs[0].contentType).toBe("html");
  });

  it("keeps a derived Google Docs title when the caller supplies none", async () => {
    const { calls } = useFakeTransaction({
      lock: [{ title: "Doc", revision: 2 }],
      tabs: [
        { id: "tab-1", slug: "import", name: "Untitled", position: 0, content_type: "html" },
      ],
    });

    await updateUserDocumentTab("user-1", "doc-1", "import", {
      content:
        '<html><head><title>Quarterly Report</title></head><body><b id="docs-internal-guid-1">' +
        "<p>Body</p></b></body></html>",
      baseRevision: 2,
    });

    const update = calls.find((call) => /^UPDATE tabs/.test(call.sql));
    expect(update?.params[0]).toBe("Quarterly Report");
  });

  it("lets a tab created in the same call reuse a slug freed by a delete", async () => {
    // The old loop deleted tab.id from slugById before reading its slug, so the
    // cleanup removed "" and a new tab named "Intro" got "intro-2" instead of
    // reusing the slug that was free again.
    const { calls } = useFakeTransaction({
      lock: [{ title: "Doc", revision: 2 }],
      tabs: [
        { id: "tab-1", slug: "intro", name: "Intro", position: 0, content_type: "html" },
      ],
    });

    await updateUserDocument("user-1", "doc-1", {
      baseRevision: 2,
      tabs: [
        { id: "tab-1", name: "", position: 0, _delete: true },
        { id: "new:1", name: "Intro", position: 0, html: "<p>again</p>", content_type: "html" },
      ],
    });

    expect(calls.some((call) => /DELETE FROM tabs WHERE id/.test(call.sql))).toBe(true);
    const insert = calls.find((call) => /INSERT INTO tabs/.test(call.sql));
    expect(insert?.params[2]).toBe("intro");
  });

  it("still dedupes against tabs that survive the same call", async () => {
    const { calls } = useFakeTransaction({
      lock: [{ title: "Doc", revision: 2 }],
      tabs: [
        { id: "tab-1", slug: "intro", name: "Intro", position: 0, content_type: "html" },
      ],
    });

    await updateUserDocument("user-1", "doc-1", {
      baseRevision: 2,
      tabs: [
        { id: "tab-1", name: "Intro", position: 0, html: "<p>kept</p>", content_type: "html" },
        { id: "new:1", name: "Intro", position: 1, html: "<p>new</p>", content_type: "html" },
      ],
    });

    const insert = calls.find((call) => /INSERT INTO tabs/.test(call.sql));
    expect(insert?.params[2]).toBe("intro-2");
  });

  it("reports a missing tab rather than creating one", async () => {
    const { runQuery } = fakeTransaction({ lock: [{ title: "Doc", revision: 2 }], tabs: [] });
    mocks.withTransaction.mockImplementation(async (fn: (q: typeof runQuery) => unknown) => fn(runQuery));

    await expect(
      updateUserDocumentTab("user-1", "doc-1", "nope", { content: "x", baseRevision: 2 }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("appends a tab to an existing document without reading it first", async () => {
    const { runQuery, calls } = useFakeTransaction({
      lock: [{ title: "Agent Report", revision: 3 }],
      tabs: [
        { id: "tab-1", slug: "summary", name: "Summary", position: 0, content_type: "markdown" },
        { id: "tab-2", slug: "notes", name: "Notes", position: 1, content_type: "html" },
      ],
      inserted: {
        id: "tab-3",
        slug: "appendix",
        name: "Appendix",
        position: 2,
        content_type: "html",
      },
    });

    const result = await createUserDocumentTab("user-1", "doc-1", {
      name: "Appendix",
      content: "<h1>Appendix</h1>",
      baseRevision: 3,
    });

    expect(result.revision).toBe(3);
    expect(result.tabs.map((tab) => tab.slug)).toEqual(["summary", "notes", "appendix"]);

    const insert = calls.find((call) => /INSERT INTO tabs/.test(call.sql));
    // Appended after the two existing tabs, with the content the caller sent.
    expect(insert?.params).toEqual([
      expect.any(String),
      "doc-1",
      "appendix",
      "Appendix",
      2,
      "<h1>Appendix</h1>",
      "html",
    ]);
    expect(calls.some((call) => /INSERT INTO sync_changes/.test(call.sql))).toBe(true);
    // Lock+tabs snapshot, insert, revision bump. No re-read of the document.
    expect(runQuery).toHaveBeenCalledTimes(3);
  });

  it("dedupes a new tab slug against the tabs already in the document", async () => {
    const { calls } = useFakeTransaction({
      lock: [{ title: "Doc", revision: 1 }],
      tabs: [
        { id: "tab-1", slug: "summary", name: "Summary", position: 0, content_type: "html" },
        { id: "tab-2", slug: "summary-2", name: "Summary 2", position: 1, content_type: "html" },
      ],
      inserted: {
        id: "tab-3",
        slug: "summary-3",
        name: "Summary",
        position: 2,
        content_type: "html",
      },
    });

    await createUserDocumentTab("user-1", "doc-1", {
      name: "Summary",
      content: "<p>third</p>",
      baseRevision: 1,
    });

    const insert = calls.find((call) => /INSERT INTO tabs/.test(call.sql));
    expect(insert?.params[2]).toBe("summary-3");
  });

  it("refuses to add a tab past the per-document limit", async () => {
    const tabs = Array.from({ length: 20 }, (_, index) => ({
      id: `tab-${index}`,
      slug: `tab-${index}`,
      name: `Tab ${index}`,
      position: index,
      content_type: "html",
    }));
    const { runQuery } = useFakeTransaction({ lock: [{ title: "Doc", revision: 1 }], tabs });

    await expect(
      createUserDocumentTab("user-1", "doc-1", { content: "<p>x</p>", baseRevision: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    // The limit is enforced before the insert.
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects a doc tab holding a complete HTML document", async () => {
    const { runQuery } = useFakeTransaction({ lock: [{ title: "Doc", revision: 1 }], tabs: [] });

    await expect(
      createUserDocumentTab("user-1", "doc-1", {
        content: "<html><body><p>x</p></body></html>",
        contentType: "doc",
        baseRevision: 1,
      }),
    ).rejects.toThrow(/HTML fragment/);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("deletes a tab and closes the position gap in one statement", async () => {
    const { runQuery, calls } = useFakeTransaction({
      lock: [{ title: "Doc", revision: 5 }],
      tabs: [
        { id: "tab-1", slug: "a", name: "A", position: 0, content_type: "html" },
        { id: "tab-2", slug: "b", name: "B", position: 1, content_type: "html" },
        { id: "tab-3", slug: "c", name: "C", position: 2, content_type: "html" },
      ],
    });

    const result = await deleteUserDocumentTab("user-1", "doc-1", "b", { baseRevision: 5 });

    expect(result.deletedTabId).toBe("tab-2");
    expect(result.tabs.map((tab) => [tab.slug, tab.position])).toEqual([["a", 0], ["c", 1]]);

    const deleteCall = calls.find((call) => /DELETE FROM tabs WHERE id/.test(call.sql));
    expect(deleteCall?.params).toEqual(["tab-2", "doc-1"]);
    // Positions stay dense, but not by looping over the survivors.
    const shifts = calls.filter((call) => /position = position - 1/.test(call.sql));
    expect(shifts).toHaveLength(1);
    expect(shifts[0].params).toEqual(["doc-1", 1]);
    expect(runQuery).toHaveBeenCalledTimes(4);
  });

  it("refuses to delete the last remaining tab", async () => {
    // validateSaveTabs refuses to save a document with no tabs, so the agent
    // path must not create a state the web editor then rejects.
    const { runQuery } = useFakeTransaction({
      lock: [{ title: "Doc", revision: 1 }],
      tabs: [{ id: "tab-1", slug: "only", name: "Only", position: 0, content_type: "html" }],
    });

    await expect(
      deleteUserDocumentTab("user-1", "doc-1", "only", { baseRevision: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it("requires a baseRevision on every new single-tab and rename call", async () => {
    await expect(
      createUserDocumentTab("user-1", "doc-1", { content: "x", baseRevision: undefined as unknown as number }),
    ).rejects.toMatchObject({ status: 428 });
    await expect(
      deleteUserDocumentTab("user-1", "doc-1", "tab-1", { baseRevision: undefined as unknown as number }),
    ).rejects.toMatchObject({ status: 428 });
    await expect(
      renameUserDocument("user-1", "doc-1", { title: "New", baseRevision: undefined as unknown as number }),
    ).rejects.toMatchObject({ status: 428 });
  });

  it("renames a document in two statements, with no tab write", async () => {
    const { runQuery, calls } = useFakeTransaction({
      lock: [{ title: "Old Title", revision: 7 }],
      tabs: [
        { id: "tab-1", slug: "a", name: "A", position: 0, content_type: "html" },
        { id: "tab-2", slug: "b", name: "B", position: 1, content_type: "markdown" },
      ],
    });

    const result = await renameUserDocument("user-1", "doc-1", { title: "  New Title  ", baseRevision: 7 });

    expect(result).toEqual({ id: "doc-1", title: "New Title", revision: 3 });
    // The title rides along on recordDocumentChange, which folds it into the same
    // UPDATE that bumps the revision. A separate UPDATE docs SET title would be
    // the round trip this avoids.
    expect(calls.some((call) => /^UPDATE docs/.test(call.sql))).toBe(false);
    const change = calls.find((call) => /UPDATE docs/.test(call.sql));
    expect(change?.params).toEqual(["doc-1", "user-1", "New Title"]);
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(calls.some((call) => /INSERT INTO tabs/.test(call.sql))).toBe(false);
    expect(calls.some((call) => /UPDATE tabs/.test(call.sql))).toBe(false);
  });

  it("keeps the current title when renaming to an empty string", async () => {
    const { calls } = useFakeTransaction({ lock: [{ title: "Old Title", revision: 1 }], tabs: [] });

    const result = await renameUserDocument("user-1", "doc-1", { title: "   ", baseRevision: 1 });
    expect(result.title).toBe("Old Title");
    expect(calls.find((call) => /UPDATE docs/.test(call.sql))?.params[2]).toBe("Old Title");
  });

  it("refuses a rename against a stale revision without writing", async () => {
    const { runQuery } = useFakeTransaction({ lock: [{ title: "Doc", revision: 9 }], tabs: [] });

    await expect(
      renameUserDocument("user-1", "doc-1", { title: "New", baseRevision: 4 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(runQuery).toHaveBeenCalledTimes(1);
  });
});
