import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateAgentToken: vi.fn(),
  recordAgentEvent: vi.fn(),
  listUserDocuments: vi.fn(),
  getUserDocument: vi.fn(),
  getUserDocumentTab: vi.fn(),
  createUserDocument: vi.fn(),
  updateUserDocument: vi.fn(),
  updateUserDocumentTab: vi.fn(),
  deleteUserDocument: vi.fn(),
  checkMcpRate: vi.fn(),
}));

vi.mock("~/lib/agent-tokens.server", () => ({
  authenticateAgentToken: mocks.authenticateAgentToken,
  recordAgentEvent: mocks.recordAgentEvent,
}));
vi.mock("~/lib/document-service.server", () => ({
  listUserDocuments: mocks.listUserDocuments,
  getUserDocument: mocks.getUserDocument,
  getUserDocumentTab: mocks.getUserDocumentTab,
  createUserDocument: mocks.createUserDocument,
  updateUserDocument: mocks.updateUserDocument,
  updateUserDocumentTab: mocks.updateUserDocumentTab,
  deleteUserDocument: mocks.deleteUserDocument,
}));
vi.mock("~/lib/agent-idempotency.server", () => ({
  withIdempotency: vi.fn(async (_identity: unknown, _key: unknown, _tool: string, run: () => Promise<unknown>) => ({
    result: await run(),
    replayed: false,
  })),
}));
vi.mock("~/lib/ratelimit.server", () => ({ checkMcpRate: mocks.checkMcpRate }));
vi.mock("~/lib/runtime.server", () => ({ isDesktopRuntime: () => false }));

import { action, loader } from "~/routes/mcp";

const identity = {
  tokenId: "token-1",
  userId: "user-1",
  email: "person@example.com",
  scopes: ["docs:read" as const],
};

function request(method: string, body: unknown, token = "hdo_test-token") {
  return new Request("https://html-docs.example/mcp", {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

async function call(method: "GET" | "POST", body: unknown, token = "hdo_test-token") {
  return (method === "GET" ? loader : action)({
    request: request(method, body, token),
    params: {},
    context: {},
  } as never);
}

describe("hosted MCP endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAgentToken.mockResolvedValue(identity);
    mocks.checkMcpRate.mockResolvedValue(true);
    mocks.listUserDocuments.mockResolvedValue({ documents: [], nextOffset: null });
  });

  it("rejects requests without a valid agent token", async () => {
    mocks.authenticateAgentToken.mockResolvedValue(null);
    const response = await call("POST", { jsonrpc: "2.0", id: 1, method: "tools/list" }, "");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer realm="html-docs"');
  });

  it("rejects non-POST transport methods", async () => {
    const response = await call("GET", {});
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
  });

  it("rate limits agent token requests", async () => {
    mocks.checkMcpRate.mockResolvedValue(false);
    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("rejects tool results that exceed the MCP response limit", async () => {
    mocks.getUserDocument.mockResolvedValue({
      id: "doc-1",
      title: "Large",
      revision: 1,
      tabCount: 1,
      contentTypes: ["html"],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      tabs: [{
        id: "tab-1",
        slug: "large",
        name: "Large",
        position: 0,
        contentType: "html",
        content: "x".repeat(3_500_001),
      }],
    });
    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_document", arguments: { documentId: "doc-1", includeContent: true } },
    });
    const payload = await response.json() as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
    expect(payload.result?.isError).toBe(true);
    expect(payload.result?.content?.[0].text).toContain("too large");
  });

  it("lists the read-only document tools", async () => {
    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as { result?: { tools?: Array<{ name: string }> } };
    expect(payload.result?.tools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["whoami", "list_documents", "get_document", "get_tab", "search_documents"]),
    );
  });

  it("scopes document listing to the authenticated user", async () => {
    mocks.listUserDocuments.mockResolvedValue({
      documents: [{ id: "doc-1", title: "Test", revision: 1 }],
      nextOffset: null,
    });
    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_documents", arguments: { limit: 10 } },
    });
    expect(response.status).toBe(200);
    expect(mocks.listUserDocuments).toHaveBeenCalledWith("user-1", { limit: 10, offset: undefined, search: undefined });
    const body = await response.text();
    expect(body).toContain("doc-1");
  });

  it("advertises the write tools", async () => {
    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    const payload = await response.json() as { result?: { tools?: Array<{ name: string }> } };
    expect(payload.result?.tools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["create_document", "update_document", "update_tab", "delete_document"]),
    );
  });

  it("refuses write tools for a read-only token without touching the database", async () => {
    for (const [name, args] of [
      ["create_document", { tabs: [{ name: "A", content: "<p>x</p>" }] }],
      ["update_document", { documentId: "doc-1", baseRevision: 1, tabs: [{ id: "t1", name: "A", position: 0, html: "<p>x</p>", content_type: "html" }] }],
      ["update_tab", { documentId: "doc-1", tabSlug: "tab-1", content: "x", baseRevision: 1 }],
      ["delete_document", { documentId: "doc-1", baseRevision: 1 }],
    ] as const) {
      const response = await call("POST", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      });
      const payload = await response.json() as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
      expect(payload.result?.isError, `${name} should be refused`).toBe(true);
      expect(payload.result?.content?.[0].text).toContain("Missing required scope");
    }
    expect(mocks.createUserDocument).not.toHaveBeenCalled();
    expect(mocks.updateUserDocument).not.toHaveBeenCalled();
    expect(mocks.updateUserDocumentTab).not.toHaveBeenCalled();
    expect(mocks.deleteUserDocument).not.toHaveBeenCalled();
  });

  it("requires docs:delete separately from docs:write", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({ ...identity, scopes: ["docs:read", "docs:write"] });
    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "delete_document", arguments: { documentId: "doc-1", baseRevision: 1 } },
    });
    const payload = await response.json() as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
    expect(payload.result?.content?.[0].text).toContain("docs:delete");
    expect(mocks.deleteUserDocument).not.toHaveBeenCalled();
  });

  it("creates a document for a write-scoped token", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({
      ...identity,
      scopes: ["docs:read", "docs:write"],
    });
    mocks.createUserDocument.mockResolvedValue({
      id: "doc-new",
      title: "Agent Report",
      revision: 2,
      tabs: [{ id: "tab-1", slug: "summary", name: "Summary", position: 0, contentType: "markdown" }],
    });

    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_document",
        arguments: {
          title: "Agent Report",
          tabs: [{ name: "Summary", content: "# Summary\n", contentType: "markdown" }],
        },
      },
    });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("doc-new");
    expect(mocks.createUserDocument).toHaveBeenCalledWith("user-1", {
      title: "Agent Report",
      tabs: [{ name: "Summary", content: "# Summary\n", contentType: "markdown" }],
    });
  });

  it("surfaces a revision conflict as a tool error rather than a crash", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({
      ...identity,
      scopes: ["docs:read", "docs:write"],
    });
    const { AgentWriteError } = await import("~/lib/document-input");
    mocks.updateUserDocumentTab.mockRejectedValue(
      new AgentWriteError("Revision conflict: the document is now at revision 9, not 4.", 409),
    );

    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "update_tab",
        arguments: { documentId: "doc-1", tabSlug: "tab-1", content: "x", baseRevision: 4 },
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
    expect(payload.result?.isError).toBe(true);
    expect(payload.result?.content?.[0].text).toContain("Revision conflict");
    expect(payload.result?.content?.[0].text).toContain("status 409");
    expect(mocks.recordAgentEvent).toHaveBeenCalledWith(
      expect.anything(),
      "update_tab",
      "doc-1",
      "error",
      expect.objectContaining({ reason: expect.stringContaining("Revision conflict") }),
    );
  });

  it("audits successful writes", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({
      ...identity,
      scopes: ["docs:read", "docs:delete"],
    });
    mocks.deleteUserDocument.mockResolvedValue({ id: "doc-1", deleted: true, revision: 5 });

    await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "delete_document", arguments: { documentId: "doc-1", baseRevision: 4 } },
    });

    expect(mocks.recordAgentEvent).toHaveBeenCalledWith(
      expect.anything(),
      "delete_document",
      "doc-1",
      "ok",
      expect.objectContaining({ replayed: false }),
    );
  });
});
