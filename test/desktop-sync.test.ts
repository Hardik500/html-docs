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
});
