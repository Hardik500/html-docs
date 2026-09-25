import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateAgentToken: vi.fn(),
  recordAgentEvent: vi.fn(),
  listUserDocuments: vi.fn(),
  getUserDocument: vi.fn(),
  getUserDocumentTab: vi.fn(),
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
});
