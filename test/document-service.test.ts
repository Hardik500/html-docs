import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("~/lib/db.server", () => ({ query: mocks.query }));

import {
  getUserDocument,
  getUserDocumentTab,
  listUserDocuments,
} from "~/lib/document-service.server";

describe("hosted MCP document service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists only documents owned by the authenticated user", async () => {
    mocks.query.mockResolvedValue({
      rows: [{
        id: "doc-1",
        title: "Agent document",
        revision: "3",
        tab_count: "2",
        content_types: ["html", "markdown"],
        created_at: "2026-01-01T00:00:00Z",
        last_activity_at: "2026-01-02T00:00:00Z",
      }],
    });

    const result = await listUserDocuments("user-1", { limit: 10, search: "Agent" });
    expect(result.documents[0].revision).toBe(3);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("owner_user_id = $1"),
      ["user-1", "%Agent%", 10, 0],
    );
  });

  it("returns document tabs with content only when requested", async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [{
          id: "doc-1",
          title: "Agent document",
          revision: "3",
          created_at: "2026-01-01T00:00:00Z",
          last_activity_at: "2026-01-02T00:00:00Z",
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: "tab-1",
          slug: "readme",
          name: "README",
          position: 0,
          content_type: "markdown",
          html: "# Agent",
        }],
      });

    const document = await getUserDocument("user-1", "doc-1", true);
    expect(document?.tabs[0].content).toBe("# Agent");
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("FROM tabs"),
      ["doc-1"],
    );
  });

  it("does not return tabs from another account", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await expect(getUserDocumentTab("user-1", "doc-1", "readme")).resolves.toBeNull();
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("d.owner_user_id = $3"),
      ["doc-1", "readme", "user-1"],
    );
  });
});
