import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  getUser: vi.fn(),
  checkSyncPushRate: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({
  query: mocks.query,
  withTransaction: mocks.withTransaction,
}));
vi.mock("~/lib/auth.server", () => ({ getUser: mocks.getUser }));
vi.mock("~/lib/ratelimit.server", () => ({
  checkSyncPushRate: mocks.checkSyncPushRate,
}));
vi.mock("~/lib/runtime.server", () => ({ isDesktopRuntime: () => false }));

import { action as syncPush } from "~/routes/sync.push";

const document = {
  id: "doc123",
  title: "Document",
  baseRevision: 4,
  force: true,
  forceRevision: 4,
  tabs: [
    {
      id: "tab123",
      slug: "tab-1",
      name: "Tab 1",
      position: 0,
      html: "<p>Local</p>",
      content_type: "html",
    },
  ],
};

describe("hosted sync force conflicts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ id: "user123", email: "user@example.com" });
    mocks.checkSyncPushRate.mockResolvedValue(true);
    mocks.withTransaction.mockImplementation(async (callback) => callback(mocks.query));
  });

  it("rejects a force push when the reviewed remote revision is stale", async () => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          owner_user_id: "user123",
          revision: 5,
          deleted_at: null,
          edit_token: "edit-token",
        },
      ],
    });

    const response = await syncPush({
      request: new Request("https://html-docs.example/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document }),
      }),
      params: {},
      context: {},
    } as unknown as Parameters<typeof syncPush>[0]);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "conflict",
      remoteRevision: 5,
    });
  });
});
