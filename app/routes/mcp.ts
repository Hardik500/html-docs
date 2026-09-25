import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Route } from "./+types/mcp";
import {
  authenticateAgentToken,
  recordAgentEvent,
  type AgentIdentity,
  type AgentScope,
} from "~/lib/agent-tokens.server";
import {
  getUserDocument,
  getUserDocumentTab,
  listUserDocuments,
} from "~/lib/document-service.server";
import { isDesktopRuntime } from "~/lib/runtime.server";

const MCP_VERSION = "0.1.0";
const MAX_REQUEST_BYTES = 1_000_000;
const DOCUMENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const TAB_SLUG_PATTERN = /^[a-zA-Z0-9_-]{1,200}$/;

function corsHeaders(request: Request): HeadersInit {
  const configured = process.env.MCP_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const requestOrigin = request.headers.get("origin");
  const allowOrigin = configured?.length
    ? requestOrigin && configured.includes(requestOrigin)
      ? requestOrigin
      : configured[0]
    : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, Last-Event-ID",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    Vary: "Origin",
  };
}

function unauthorized(request: Request): Response {
  const resourceUrl = process.env.MCP_RESOURCE_URL || new URL("/mcp", request.url).toString();
  return Response.json(
    { error: "unauthorized", message: "A valid html-docs agent token is required." },
    {
      status: 401,
      headers: {
        ...corsHeaders(request),
        "Cache-Control": "no-store",
        "WWW-Authenticate": `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource", resourceUrl).toString()}"`,
      },
    },
  );
}

function toolResult(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function hasScope(identity: AgentIdentity, scope: AgentScope): boolean {
  return identity.scopes.includes(scope);
}

function resourceUrl(request: Request): URL {
  return new URL(process.env.MCP_RESOURCE_URL || new URL("/mcp", request.url).toString());
}

function createMcpServer(identity: AgentIdentity, request: Request): McpServer {
  const server = new McpServer({ name: "html-docs", version: MCP_VERSION });

  const audit = (
    toolName: string,
    documentId: string | null,
    status: "ok" | "error",
    metadata: Record<string, unknown> = {},
  ) => {
    void recordAgentEvent(identity, toolName, documentId, status, metadata);
  };

  server.registerTool(
    "whoami",
    {
      description: "Return the authenticated html-docs agent account and granted scopes.",
      inputSchema: {},
    },
    async () => {
      audit("whoami", null, "ok");
      return toolResult({
        userId: identity.userId,
        email: identity.email,
        scopes: identity.scopes,
        resource: resourceUrl(request).toString(),
      });
    },
  );

  server.registerTool(
    "list_documents",
    {
      description: "List documents owned by the authenticated account, most recently active first.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
        search: z.string().max(200).optional(),
      },
    },
    async ({ limit, offset, search }) => {
      if (!hasScope(identity, "docs:read")) return toolError("Missing required scope: docs:read");
      const result = await listUserDocuments(identity.userId, { limit, offset, search });
      audit("list_documents", null, "ok", { count: result.documents.length });
      return toolResult(result as unknown as Record<string, unknown>);
    },
  );

  server.registerTool(
    "search_documents",
    {
      description: "Search document titles owned by the authenticated account.",
      inputSchema: {
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ query: search, limit, offset }) => {
      if (!hasScope(identity, "docs:read")) return toolError("Missing required scope: docs:read");
      const result = await listUserDocuments(identity.userId, { limit, offset, search });
      audit("search_documents", null, "ok", { query: search, count: result.documents.length });
      return toolResult(result as unknown as Record<string, unknown>);
    },
  );

  server.registerTool(
    "get_document",
    {
      description: "Read one owned document. Tab content is omitted unless includeContent is true.",
      inputSchema: {
        documentId: z.string().regex(DOCUMENT_ID_PATTERN),
        includeContent: z.boolean().optional(),
      },
    },
    async ({ documentId, includeContent }) => {
      if (!hasScope(identity, "docs:read")) return toolError("Missing required scope: docs:read");
      const document = await getUserDocument(identity.userId, documentId, Boolean(includeContent));
      if (!document) {
        audit("get_document", documentId, "error", { reason: "not_found" });
        return toolError("Document not found.");
      }
      audit("get_document", documentId, "ok", { includeContent: Boolean(includeContent) });
      return toolResult(document as unknown as Record<string, unknown>);
    },
  );

  server.registerTool(
    "get_tab",
    {
      description: "Read the source content of one tab in an owned document.",
      inputSchema: {
        documentId: z.string().regex(DOCUMENT_ID_PATTERN),
        tabSlug: z.string().regex(TAB_SLUG_PATTERN),
      },
    },
    async ({ documentId, tabSlug }) => {
      if (!hasScope(identity, "docs:read")) return toolError("Missing required scope: docs:read");
      const tab = await getUserDocumentTab(identity.userId, documentId, tabSlug);
      if (!tab) {
        audit("get_tab", documentId, "error", { tabSlug, reason: "not_found" });
        return toolError("Document tab not found.");
      }
      audit("get_tab", documentId, "ok", { tabSlug });
      return toolResult(tab as unknown as Record<string, unknown>);
    },
  );

  return server;
}

async function handleMcpRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (isDesktopRuntime()) {
    throw new Response("Not found", { status: 404 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return unauthorized(request);

  let identity: AgentIdentity | null;
  try {
    identity = await authenticateAgentToken(token);
  } catch {
    return Response.json(
      { error: "auth_unavailable", message: "Agent authentication is temporarily unavailable." },
      { status: 503, headers: { ...corsHeaders(request), "Cache-Control": "no-store" } },
    );
  }
  if (!identity) return unauthorized(request);

  const server = createMcpServer(identity, request);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_REQUEST_BYTES,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(request, {
    authInfo: {
      token: identity.tokenId,
      clientId: `pat:${identity.tokenId}`,
      scopes: identity.scopes,
      ...(identity.expiresAt ? { expiresAt: identity.expiresAt } : {}),
      resource: resourceUrl(request),
      extra: { userId: identity.userId },
    },
  });
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

export async function loader({ request }: Route.LoaderArgs) {
  return handleMcpRequest(request);
}

export async function action({ request }: Route.ActionArgs) {
  return handleMcpRequest(request);
}
