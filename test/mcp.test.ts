import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateAgentToken: vi.fn(),
  recordAgentEvent: vi.fn(),
  listUserDocuments: vi.fn(),
  getUserDocument: vi.fn(),
  getUserDocumentTab: vi.fn(),
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
    mocks.listUserDocuments.mockResolvedValue({ documents: [], nextOffset: null });
  });

  it("rejects requests without a valid agent token", async () => {
    mocks.authenticateAgentToken.mockResolvedValue(null);
    const response = await call("POST", { jsonrpc: "2.0", id: 1, method: "tools/list" }, "");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource");
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
