import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, query } from "~/lib/db.server";
import { markLocalDocumentDirty } from "~/lib/sync.server";
import { action as desktopSync } from "~/routes/desktop.sync";

let dataDir: string;
const previousRuntime = process.env.HTML_DOCS_RUNTIME;
const previousDataDir = process.env.HTML_DOCS_DATA_DIR;
const previousSyncUrl = process.env.HTML_DOCS_SYNC_URL;

function request(mode: string): Request {
  return new Request(`http://127.0.0.1:3000/__desktop/sync?mode=${mode}`, {
    method: "POST",
    headers: { Authorization: "Bearer dhd_test-token" },
  });
}

describe("desktop sync bridge", () => {
  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "html-docs-sync-"));
    process.env.HTML_DOCS_RUNTIME = "desktop";
    process.env.HTML_DOCS_DATA_DIR = dataDir;
    process.env.HTML_DOCS_SYNC_URL = "https://cloud.example.test";
  });

  afterAll(async () => {
    await closeDatabase();
    await rm(dataDir, { recursive: true, force: true });
    if (previousRuntime === undefined) delete process.env.HTML_DOCS_RUNTIME;
    else process.env.HTML_DOCS_RUNTIME = previousRuntime;
    if (previousDataDir === undefined) delete process.env.HTML_DOCS_DATA_DIR;
    else process.env.HTML_DOCS_DATA_DIR = previousDataDir;
    if (previousSyncUrl === undefined) delete process.env.HTML_DOCS_SYNC_URL;
    else process.env.HTML_DOCS_SYNC_URL = previousSyncUrl;
    vi.unstubAllGlobals();
  });

  it("pushes dirty local documents and records the remote revision", async () => {
    await query(
      "INSERT INTO docs (id, title, owner_user_id, edit_token) VALUES ($1, $2, $3, $4)",
      ["sync-doc", "Sync document", "00000000-0000-0000-0000-000000000001", "local-token"],
    );
    await query(
      "INSERT INTO tabs (id, doc_id, slug, name, position, html, content_type) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      ["sync-tab", "sync-doc", "tab-1", "Tab 1", 0, "<h1>Sync</h1>", "html"],
    );
    await markLocalDocumentDirty("sync-doc");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: "sync-doc",
            revision: 4,
            deleted: false,
            editToken: "remote-token",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const response = await desktopSync({
      request: request("push"),
      params: {},
      context: undefined,
    } as unknown as Parameters<typeof desktopSync>[0]);

    expect(response.status).toBe(200);
    const state = await query<{
      remote_revision: string | number;
      dirty: boolean;
      force_push: boolean;
    }>(
      "SELECT remote_revision, dirty, force_push FROM sync_state WHERE doc_id = $1",
      ["sync-doc"],
    );
    expect(state.rows).toEqual([
      { remote_revision: 4, dirty: false, force_push: false },
    ]);
  });

  it("keeps newer local edits dirty when a push completes", async () => {
    await query(
      "INSERT INTO docs (id, title, owner_user_id, edit_token) VALUES ($1, $2, $3, $4)",
      ["racedoc", "Race document", "00000000-0000-0000-0000-000000000001", "race-token"],
    );
    await query(
      "INSERT INTO tabs (id, doc_id, slug, name, position, html, content_type) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      ["racetab", "racedoc", "tab-1", "Tab 1", 0, "<h1>Before</h1>", "html"],
    );
    await markLocalDocumentDirty("racedoc");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await query(
          `UPDATE sync_state
              SET dirty = TRUE, change_generation = change_generation + 1
            WHERE doc_id = $1`,
          ["racedoc"],
        );
        return new Response(
          JSON.stringify({
            id: "racedoc",
            revision: 2,
            deleted: false,
            editToken: "remote-token",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const response = await desktopSync({
      request: request("push"),
      params: {},
      context: undefined,
    } as unknown as Parameters<typeof desktopSync>[0]);

    expect(response.status).toBe(200);
    const state = await query<{
      remote_revision: string | number;
      dirty: boolean;
      change_generation: string | number;
    }>(
      "SELECT remote_revision, dirty, change_generation FROM sync_state WHERE doc_id = $1",
      ["racedoc"],
    );
    expect(state.rows).toEqual([
      { remote_revision: 0, dirty: true, change_generation: 2 },
    ]);

    await query("DELETE FROM docs WHERE id = $1", ["racedoc"]);
  });

  it("applies pulled revisions to the local editor revision", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            cursor: 5,
            hasMore: false,
            documents: [
              {
                id: "sync-doc",
                title: "Synced document",
                revision: 7,
                deleted: false,
                editToken: "remote-token",
                tabs: [
                  {
                    id: "sync-tab",
                    slug: "tab-1",
                    name: "Tab 1",
                    position: 0,
                    html: "<h1>Pulled</h1>",
                    content_type: "html",
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const response = await desktopSync({
      request: request("pull"),
      params: {},
      context: undefined,
    } as unknown as Parameters<typeof desktopSync>[0]);

    expect(response.status).toBe(200);
    const doc = await query<{ revision: string | number; title: string }>(
      "SELECT revision, title FROM docs WHERE id = $1",
      ["sync-doc"],
    );
    expect(doc.rows).toEqual([{ revision: 7, title: "Synced document" }]);
  });
});
