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
  createUserDocumentTab: vi.fn(),
  deleteUserDocumentTab: vi.fn(),
  renameUserDocument: vi.fn(),
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
  createUserDocumentTab: mocks.createUserDocumentTab,
  deleteUserDocumentTab: mocks.deleteUserDocumentTab,
  renameUserDocument: mocks.renameUserDocument,
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
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer realm="html-docs", resource_metadata="https://html-docs.example/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("rejects a credential minted for a different MCP resource", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({
      ...identity,
      credentialType: "oauth",
      resource: "https://other-deployment.example/mcp",
    });
    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(response.status).toBe(401);
  });

  it("accepts a credential bound to this exact resource", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({
      ...identity,
      credentialType: "oauth",
      resource: "https://html-docs.example/mcp",
    });
    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(response.status).toBe(200);
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
      expect.arrayContaining([
        "create_document",
        "update_document",
        "update_tab",
        "create_tab",
        "delete_tab",
        "rename_document",
        "delete_document",
      ]),
    );
  });

  it("refuses write tools for a read-only token without touching the database", async () => {
    for (const [name, args] of [
      ["create_document", { tabs: [{ name: "A", content: "<p>x</p>" }] }],
      ["update_document", { documentId: "doc-1", baseRevision: 1, tabs: [{ id: "t1", name: "A", position: 0, content: "<p>x</p>", contentType: "html" }] }],
      ["update_tab", { documentId: "doc-1", tabSlug: "tab-1", content: "x", baseRevision: 1 }],
      ["create_tab", { documentId: "doc-1", content: "x", baseRevision: 1 }],
      ["delete_tab", { documentId: "doc-1", tabSlug: "tab-1", baseRevision: 1 }],
      ["rename_document", { documentId: "doc-1", title: "New", baseRevision: 1 }],
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
    expect(mocks.createUserDocumentTab).not.toHaveBeenCalled();
    expect(mocks.deleteUserDocumentTab).not.toHaveBeenCalled();
    expect(mocks.renameUserDocument).not.toHaveBeenCalled();
    expect(mocks.deleteUserDocument).not.toHaveBeenCalled();
  });

  it("requires docs:delete separately from docs:write", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({ ...identity, scopes: ["docs:read", "docs:write"] });
    for (const [name, args] of [
      ["delete_document", { documentId: "doc-1", baseRevision: 1 }],
      ["delete_tab", { documentId: "doc-1", tabSlug: "tab-1", baseRevision: 1 }],
    ] as const) {
      const response = await call("POST", {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      });
      const payload = await response.json() as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
      expect(payload.result?.isError, `${name} should require docs:delete`).toBe(true);
      expect(payload.result?.content?.[0].text).toContain("docs:delete");
    }
    expect(mocks.deleteUserDocument).not.toHaveBeenCalled();
    expect(mocks.deleteUserDocumentTab).not.toHaveBeenCalled();
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

  it("creates a tab on an existing document without reading the document first", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({
      ...identity,
      scopes: ["docs:read", "docs:write"],
    });
    mocks.createUserDocumentTab.mockResolvedValue({
      id: "doc-1",
      title: "Agent Report",
      revision: 4,
      tabs: [
        { id: "tab-1", slug: "summary", name: "Summary", position: 0, contentType: "markdown" },
        { id: "tab-2", slug: "appendix", name: "Appendix", position: 1, contentType: "html" },
      ],
    });

    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_tab",
        arguments: {
          documentId: "doc-1",
          name: "Appendix",
          content: "<h1>Appendix</h1>",
          contentType: "html",
          baseRevision: 3,
          idempotencyKey: "tab-appendix",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(mocks.createUserDocumentTab).toHaveBeenCalledWith("user-1", "doc-1", {
      name: "Appendix",
      content: "<h1>Appendix</h1>",
      contentType: "html",
      baseRevision: 3,
    });
    expect(mocks.getUserDocument).not.toHaveBeenCalled();
    expect(mocks.updateUserDocument).not.toHaveBeenCalled();
    expect(await response.text()).toContain("appendix");
  });

  it("renames a document without touching its tabs", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({
      ...identity,
      scopes: ["docs:read", "docs:write"],
    });
    mocks.renameUserDocument.mockResolvedValue({ id: "doc-1", title: "Renamed", revision: 6 });

    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "rename_document",
        arguments: { documentId: "doc-1", title: "Renamed", baseRevision: 5 },
      },
    });

    expect(mocks.renameUserDocument).toHaveBeenCalledWith("user-1", "doc-1", {
      title: "Renamed",
      baseRevision: 5,
    });
    expect(mocks.updateUserDocument).not.toHaveBeenCalled();
    expect(mocks.getUserDocument).not.toHaveBeenCalled();
    expect(await response.text()).toContain("Renamed");
  });

  it("surfaces a revision conflict from create_tab as a tool error, not a crash", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({
      ...identity,
      scopes: ["docs:read", "docs:write"],
    });
    const { AgentWriteError } = await import("~/lib/document-input");
    mocks.createUserDocumentTab.mockRejectedValue(
      new AgentWriteError("Revision conflict: the document is now at revision 9, not 4.", 409),
    );

    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_tab",
        arguments: { documentId: "doc-1", content: "x", baseRevision: 4 },
      },
    });

    const payload = await response.json() as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
    expect(payload.result?.isError).toBe(true);
    expect(payload.result?.content?.[0].text).toContain("Revision conflict");
    expect(payload.result?.content?.[0].text).toContain("status 409");
    expect(mocks.recordAgentEvent).toHaveBeenCalledWith(
      expect.anything(),
      "create_tab",
      "doc-1",
      "error",
      expect.objectContaining({ reason: expect.stringContaining("Revision conflict") }),
    );
  });

  it("explains a kept tab that omits the fields the validator requires", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({
      ...identity,
      scopes: ["docs:read", "docs:write"],
    });

    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "update_document",
        arguments: { documentId: "doc-1", baseRevision: 1, tabs: [{ id: "t1" }] },
      },
    });

    const payload = await response.json() as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
    expect(payload.result?.isError).toBe(true);
    expect(payload.result?.content?.[0].text).toMatch(/name is required on every tab you keep/);
    expect(payload.result?.content?.[0].text).toMatch(/content is required on every tab you keep/);
    expect(mocks.updateUserDocument).not.toHaveBeenCalled();
  });

  it("accepts a delete entry that carries no content", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({
      ...identity,
      scopes: ["docs:read", "docs:write"],
    });
    mocks.updateUserDocument.mockResolvedValue({
      id: "doc-1",
      title: "Doc",
      revision: 3,
      tabs: [],
    });

    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "update_document",
        arguments: {
          documentId: "doc-1",
          baseRevision: 2,
          tabs: [
            { id: "t1", name: "Keep", position: 0, content: "<p>a</p>", contentType: "html" },
            { id: "t2", _delete: true },
          ],
        },
      },
    });

    const payload = await response.json() as { result?: { isError?: boolean } };
    expect(payload.result?.isError).toBeFalsy();
    expect(mocks.updateUserDocument).toHaveBeenCalledWith(
      "user-1",
      "doc-1",
      expect.objectContaining({
        tabs: [
          { id: "t1", name: "Keep", position: 0, html: "<p>a</p>", content_type: "html" },
          { id: "t2", name: "", position: 0, _delete: true },
        ],
      }),
    );
  });

  it("reports a validator Response as its message, not [object Response]", async () => {
    mocks.authenticateAgentToken.mockResolvedValue({
      ...identity,
      scopes: ["docs:read", "docs:write"],
    });

    // Deleting every tab is refused by validateSaveTabs, which throws a Response
    // rather than an AgentWriteError because the web editor shares it.
    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "update_document",
        arguments: {
          documentId: "doc-1",
          baseRevision: 2,
          tabs: [{ id: "t1", _delete: true }],
        },
      },
    });

    const payload = await response.json() as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
    expect(payload.result?.isError).toBe(true);
    expect(payload.result?.content?.[0].text).toContain("at least one tab");
    expect(payload.result?.content?.[0].text).not.toContain("[object Response]");
    expect(mocks.updateUserDocument).not.toHaveBeenCalled();
  });

  it("advertises the enforced tab limit rather than a higher one", async () => {
    const response = await call("POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    const payload = await response.json() as {
      result?: { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> };
    };
    const tool = payload.result?.tools?.find((entry) => entry.name === "update_document");
    const schema = JSON.stringify(tool?.inputSchema);
    expect(schema).toContain('"maxItems":20');
    expect(schema).not.toContain('"maxItems":40');
    // The limit the agent reads is the limit the validator enforces, because the
    // description interpolates MAX_TABS rather than restating it.
    expect(tool?.description).toContain("at most 20 tabs");
    expect(tool?.description).toContain("slugs are assigned when a tab is created");
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
