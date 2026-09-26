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
  createUserDocument,
  deleteUserDocument,
  getUserDocument,
  getUserDocumentTab,
  listUserDocuments,
  updateUserDocument,
  updateUserDocumentTab,
} from "~/lib/document-service.server";
import { withIdempotency } from "~/lib/agent-idempotency.server";
import { AgentWriteError, validateNewDocumentTabs, validateSaveTabs } from "~/lib/document-input";
import { checkMcpRate } from "~/lib/ratelimit.server";
import { isDesktopRuntime } from "~/lib/runtime.server";

const MCP_VERSION = "0.1.0";
const MAX_REQUEST_BYTES = 1_000_000;
const MAX_TOOL_OUTPUT_BYTES = 3_500_000;
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, Last-Event-ID",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };
}

function unauthorized(request: Request): Response {
  const resource = resourceUrl(request);
  const metadataUrl = new URL("/.well-known/oauth-protected-resource/mcp", resource).toString();
  return Response.json(
    { error: "unauthorized", message: "A valid html-docs agent token is required." },
    {
      status: 401,
      headers: {
        ...corsHeaders(request),
        "Cache-Control": "no-store",
        "WWW-Authenticate": `Bearer realm="html-docs", resource_metadata="${metadataUrl}"`,
      },
    },
  );
}

/** Rejects a credential minted for a different MCP resource. */
function isWrongAudience(identity: AgentIdentity, request: Request): boolean {
  if (!identity.resource) return false;
  return identity.resource.replace(/\/+$/, "") !== resourceUrl(request).toString().replace(/\/+$/, "");
}

function toolResult(value: Record<string, unknown>) {
  const text = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(text, "utf8") > MAX_TOOL_OUTPUT_BYTES) {
    return toolError("The result is too large for one MCP response. Use get_tab to read a smaller section.");
  }
  return {
    content: [{ type: "text" as const, text }],
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

const contentTypeSchema = z.enum(["html", "markdown", "pdf", "doc"]);

/**
 * The `contentType` contract, shared by every tool that accepts tab content.
 *
 * This was previously undocumented: an agent had to guess, and the two
 * reasonable guesses were both wrong in a way that produced a document which
 * looked fine in the editor and was broken on export.
 */
const CONTENT_TYPE_GUIDE =
  'contentType: "html" for HTML — a complete document OR a fragment; this is the right ' +
  'choice for Google Docs/Sheets/Word "Webpage" exports and for anything pasted from a ' +
  'rich-text editor. "doc" for an HTML FRAGMENT only (the TipTap/mammoth rich-text format); ' +
  'a complete document is rejected because it would be nested inside another document. ' +
  '"markdown" for Markdown source, never for HTML. "pdf" for base64 PDF data. ' +
  'Google Docs and Sheets markup is cleaned up automatically for "html" and "doc" ' +
  '(wrapper removed, presentational CSS dropped, bold/italic/underline preserved as tags). ' +
  "Per-tab size limits: 500000 bytes for html/markdown, 2800000 for doc/pdf.";

const tabWriteSchema = z.object({
  id: z.string().max(64).optional(),
  slug: z.string().max(200).optional(),
  name: z.string().max(200).optional(),
  position: z.number().int().min(0).optional(),
  content: z.string().optional(),
  contentType: contentTypeSchema.optional(),
  _delete: z.boolean().optional(),
});

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
      audit("search_documents", null, "ok", { count: result.documents.length });
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

  // ── Write tools ──────────────────────────────────────────────────────────
  //
  // Every mutating tool requires an explicit `baseRevision` so an agent can
  // never silently overwrite a newer human or agent edit, and accepts an
  // `idempotencyKey` so a retried call is safe.

  const runWrite = async <T>(
    toolName: string,
    documentId: string | null,
    idempotencyKey: string | null,
    metadata: Record<string, unknown>,
    run: () => Promise<T>,
  ) => {
    try {
      const { result, replayed } = await withIdempotency(identity, idempotencyKey, toolName, run);
      audit(toolName, documentId, "ok", { ...metadata, replayed });
      return toolResult({
        ...(result as unknown as Record<string, unknown>),
        idempotencyKeyApplied: Boolean(idempotencyKey),
        replayed,
      });
    } catch (error) {
      if (error instanceof AgentWriteError) {
        audit(toolName, documentId, "error", { ...metadata, reason: error.message.slice(0, 200) });
        return toolError(`${error.message} (status ${error.status})`);
      }
      throw error;
    }
  };

  server.registerTool(
    "create_document",
    {
      description:
        "Create a new document owned by the authenticated account. Requires docs:write. " +
        "Pass the same idempotencyKey when retrying to avoid creating duplicates. " +
        CONTENT_TYPE_GUIDE,
      inputSchema: {
        title: z.string().max(500).optional(),
        tabs: z
          .array(
            z.object({
              name: z.string().max(200).optional(),
              content: z.string(),
              contentType: contentTypeSchema.optional(),
            }),
          )
          .min(1)
          .max(20),
        idempotencyKey: z.string().max(200).optional(),
      },
    },
    async ({ title, tabs, idempotencyKey }) => {
      if (!hasScope(identity, "docs:write")) return toolError("Missing required scope: docs:write");
      const validated = validateNewDocumentTabs(tabs);
      return runWrite(
        "create_document",
        null,
        idempotencyKey ?? null,
        { tabCount: validated.length },
        () => createUserDocument(identity.userId, { title, tabs: validated }),
      );
    },
  );

  server.registerTool(
    "update_document",
    {
      description:
        "Replace the title and/or full tab list of an owned document. Requires docs:write. " +
        "Read the document first and pass its current revision as baseRevision. " +
        "This replaces the whole tab list, so include every existing tab. " +
        CONTENT_TYPE_GUIDE,
      inputSchema: {
        documentId: z.string().regex(DOCUMENT_ID_PATTERN),
        title: z.string().max(500).optional(),
        tabs: z.array(tabWriteSchema).min(1).max(40),
        baseRevision: z.number().int().min(0),
        idempotencyKey: z.string().max(200).optional(),
      },
    },
    async ({ documentId, title, tabs, baseRevision, idempotencyKey }) => {
      if (!hasScope(identity, "docs:write")) return toolError("Missing required scope: docs:write");
      // The tool takes `content`/`contentType` like the other write tools;
      // validateSaveTabs() speaks the web editor's `html`/`content_type`. Adapt
      // here rather than loosening the validator both callers share.
      const validated = validateSaveTabs(
        tabs.map((tab) => ({
          ...tab,
          html: tab.content,
          content_type: tab.contentType,
        })),
      );
      return runWrite(
        "update_document",
        documentId,
        idempotencyKey ?? null,
        { tabCount: validated.length, hasTitle: title !== undefined },
        () => updateUserDocument(identity.userId, documentId, { title, tabs: validated, baseRevision }),
      );
    },
  );

  server.registerTool(
    "update_tab",
    {
      description:
        "Update one tab of an owned document by slug. Requires docs:write. " +
        "Read the document first and pass its current revision as baseRevision. " +
        CONTENT_TYPE_GUIDE,
      inputSchema: {
        documentId: z.string().regex(DOCUMENT_ID_PATTERN),
        tabSlug: z.string().regex(TAB_SLUG_PATTERN),
        name: z.string().max(200).optional(),
        content: z.string().optional(),
        contentType: contentTypeSchema.optional(),
        baseRevision: z.number().int().min(0),
        idempotencyKey: z.string().max(200).optional(),
      },
    },
    async ({ documentId, tabSlug, name, content, contentType, baseRevision, idempotencyKey }) => {
      if (!hasScope(identity, "docs:write")) return toolError("Missing required scope: docs:write");
      return runWrite(
        "update_tab",
        documentId,
        idempotencyKey ?? null,
        { tabSlug, hasContent: content !== undefined },
        () =>
          updateUserDocumentTab(identity.userId, documentId, tabSlug, {
            name,
            content,
            contentType,
            baseRevision,
          }),
      );
    },
  );

  server.registerTool(
    "delete_document",
    {
      description:
        "Soft-delete an owned document and its tabs. Requires docs:delete. " +
        "Read the document first and pass its current revision as baseRevision.",
      inputSchema: {
        documentId: z.string().regex(DOCUMENT_ID_PATTERN),
        baseRevision: z.number().int().min(0),
        idempotencyKey: z.string().max(200).optional(),
      },
    },
    async ({ documentId, baseRevision, idempotencyKey }) => {
      if (!hasScope(identity, "docs:delete")) return toolError("Missing required scope: docs:delete");
      return runWrite(
        "delete_document",
        documentId,
        idempotencyKey ?? null,
        {},
        () => deleteUserDocument(identity.userId, documentId, { baseRevision }),
      );
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
  if (request.method !== "POST") {
    return Response.json(
      { error: "method_not_allowed", message: "The stateless MCP endpoint accepts POST requests." },
      {
        status: 405,
        headers: { ...corsHeaders(request), Allow: "POST, OPTIONS", "Cache-Control": "no-store" },
      },
    );
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
  if (isWrongAudience(identity, request)) return unauthorized(request);

  try {
    const allowed = await checkMcpRate(identity.tokenId);
    if (!allowed) {
      return Response.json(
        { error: "rate_limited", message: "Agent request limit exceeded. Try again shortly." },
        {
          status: 429,
          headers: {
            ...corsHeaders(request),
            "Cache-Control": "no-store",
            "Retry-After": "60",
          },
        },
      );
    }
  } catch {
    return Response.json(
      { error: "rate_limit_unavailable", message: "MCP request limiting is temporarily unavailable." },
      { status: 503, headers: { ...corsHeaders(request), "Cache-Control": "no-store" } },
    );
  }

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
  const body = await response.text();
  await Promise.allSettled([server.close(), transport.close()]);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) headers.set(key, value);
  headers.set("Cache-Control", "no-store");
  return new Response(body, { status: response.status, headers });
}

export async function loader({ request }: Route.LoaderArgs) {
  return handleMcpRequest(request);
}

export async function action({ request }: Route.ActionArgs) {
  return handleMcpRequest(request);
}
