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
  deleteUserDocument,
  updateUserDocument,
  updateUserDocumentTab,
} from "~/lib/document-service.server";
import { AgentWriteError } from "~/lib/document-input";

/** Builds a runQuery that answers the known statements the write path issues. */
function fakeTransaction(handlers: {
  lock?: Array<{ title: string; revision: number }>;
  tabs?: Array<Record<string, unknown>>;
}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const runQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/FOR UPDATE/.test(sql)) {
      return { rows: handlers.lock ?? [] };
    }
    if (/FROM tabs/.test(sql) && /WHERE doc_id = \$1 AND slug/.test(sql)) {
      return { rows: handlers.tabs ?? [] };
    }
    if (/SELECT id, slug FROM tabs/.test(sql)) {
      return {
        rows: (handlers.tabs ?? []).map((tab) => ({ id: tab.id, slug: tab.slug })),
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
    const { runQuery, calls } = fakeTransaction({
      lock: [{ title: "Doc", revision: 2 }],
      tabs: [
        { id: "tab-1", slug: "intro", name: "Intro", position: 0, content_type: "markdown", html: "# Intro" },
      ],
    });
    mocks.withTransaction.mockImplementation(async (fn: (q: typeof runQuery) => unknown) => fn(runQuery));

    const result = await updateUserDocumentTab("user-1", "doc-1", "intro", {
      content: "# Updated",
      baseRevision: 2,
    });

    expect(result.revision).toBe(3);
    const update = calls.find((call) => /^UPDATE tabs/.test(call.sql));
    expect(update?.params).toEqual(expect.arrayContaining(["Intro", "# Updated", "markdown", "tab-1", "doc-1"]));
    // A single-tab edit must not delete or rewrite other tabs.
    expect(calls.some((call) => /DELETE FROM tabs/.test(call.sql))).toBe(false);
  });

  it("reports a missing tab rather than creating one", async () => {
    const { runQuery } = fakeTransaction({ lock: [{ title: "Doc", revision: 2 }], tabs: [] });
    mocks.withTransaction.mockImplementation(async (fn: (q: typeof runQuery) => unknown) => fn(runQuery));

    await expect(
      updateUserDocumentTab("user-1", "doc-1", "nope", { content: "x", baseRevision: 2 }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
