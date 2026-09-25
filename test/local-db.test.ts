import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, query, withTransaction } from "~/lib/db.server";
import { markLocalDocumentDirty } from "~/lib/sync.server";

let dataDir: string;
const previousRuntime = process.env.HTML_DOCS_RUNTIME;
const previousDataDir = process.env.HTML_DOCS_DATA_DIR;

describe("desktop local database", () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "html-docs-local-"));
    process.env.HTML_DOCS_RUNTIME = "desktop";
    process.env.HTML_DOCS_DATA_DIR = dataDir;
  });

  afterAll(async () => {
    await closeDatabase();
    await rm(dataDir, { recursive: true, force: true });
    if (previousRuntime === undefined) delete process.env.HTML_DOCS_RUNTIME;
    else process.env.HTML_DOCS_RUNTIME = previousRuntime;
    if (previousDataDir === undefined) delete process.env.HTML_DOCS_DATA_DIR;
    else process.env.HTML_DOCS_DATA_DIR = previousDataDir;
  });

  it("initialises the local schema and persists documents", async () => {
    await query(
      "INSERT INTO docs (id, title, owner_user_id, edit_token) VALUES ($1, $2, $3, $4)",
      ["local-doc", "Local document", "00000000-0000-0000-0000-000000000001", "token"],
    );
    await query(
      "INSERT INTO tabs (id, doc_id, slug, name, position, html, content_type) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      ["local-tab", "local-doc", "tab-1", "Tab 1", 0, "<h1>Offline</h1>", "html"],
    );

    const result = await query<{ title: string; content_type: string }>(
      "SELECT d.title, t.content_type FROM docs d JOIN tabs t ON t.doc_id = d.id WHERE d.id = $1",
      ["local-doc"],
    );

    expect(result.rows).toEqual([{ title: "Local document", content_type: "html" }]);
  });

  it("tracks documents that need cloud sync", async () => {
    await markLocalDocumentDirty("local-doc");

    const result = await query<{ dirty: boolean; deleted: boolean }>(
      "SELECT dirty, deleted FROM sync_state WHERE doc_id = $1",
      ["local-doc"],
    );
    expect(result.rows).toEqual([{ dirty: true, deleted: false }]);
  });

  it("persists documents after closing and reopening", async () => {
    await closeDatabase();
    const result = await query<{ title: string }>(
      "SELECT title FROM docs WHERE id = $1",
      ["local-doc"],
    );
    expect(result.rows).toEqual([{ title: "Local document" }]);
  });

  it("supports local transactions", async () => {
    await withTransaction(async (runQuery) => {
      await runQuery(
        "INSERT INTO docs (id, title, owner_user_id, edit_token) VALUES ($1, $2, $3, $4)",
        ["transaction-doc", "Transaction document", "00000000-0000-0000-0000-000000000001", "token"],
      );
    });

    const result = await query<{ title: string }>(
      "SELECT title FROM docs WHERE id = $1",
      ["transaction-doc"],
    );
    expect(result.rows).toEqual([{ title: "Transaction document" }]);
  });
});
