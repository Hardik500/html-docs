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
  createUserDocumentTab,
  deleteUserDocument,
  deleteUserDocumentTab,
  getUserDocument,
  getUserDocumentTab,
  listUserDocuments,
  renameUserDocument,
  updateUserDocument,
  updateUserDocumentTab,
} from "~/lib/document-service.server";
import { withIdempotency } from "~/lib/agent-idempotency.server";
import {
  AgentWriteError,
  MAX_TABS,
  validateNewDocumentTabs,
  validateSaveTabs,
} from "~/lib/document-input";
import { checkMcpRate } from "~/lib/ratelimit.server";
import { isDesktopRuntime } from "~/lib/runtime.server";
import { mcpResourceUrl } from "~/lib/mcp-resource.server";

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

/**
 * Maps a write-path failure onto a tool error, or returns null when the error is
 * not one a caller can act on.
 *
 * The shared document-input validators throw two different things:
 * `validateSaveTabs` throws a `Response` so the web editor can answer a form post
 * with one, while the agent-facing validators throw `AgentWriteError`. Without
 * this, a rejected `update_document` reached the client as the literal text
 * `[object Response]`.
 */
async function toolFailure(error: unknown): Promise<ReturnType<typeof toolError> | null> {
  if (error instanceof AgentWriteError) {
    return toolError(`${error.message} (status ${error.status})`);
  }
  if (error instanceof Response) {
    const message = (await error.text().catch(() => "")).trim() || "Invalid document content";
    return toolError(`${message} (status ${error.status})`);
  }
  return null;
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
  "Per-tab size limits: 500000 bytes for html/markdown, 2800000 for doc/pdf. " +
  "A document may hold at most " +
  MAX_TABS +
  " tabs. Tab slugs are assigned when a tab is created and never change, so renaming a " +
  "tab does not change its URL — /raw and public share links keep working.";

/**
 * One entry in a whole-document replacement.
 *
 * `name`, `position`, and `content` are only optional here because a `_delete`
 * entry carries none of them — validateSaveTabs() enforces that split on the
 * server, and this refinement surfaces the same rule at the tool boundary so an
 * agent gets "content is required unless _delete is true" instead of discovering
 * it as "Tab content is required" after a full document read.
 */
const tabWriteSchema = z
  .object({
    id: z.string().max(64).optional(),
    slug: z.string().max(200).optional(),
    name: z.string().max(200).optional(),
    position: z.number().int().min(0).optional(),
    content: z.string().optional(),
    contentType: contentTypeSchema.optional(),
    _delete: z.boolean().optional(),
  })
  .superRefine((tab, ctx) => {
    if (tab._delete === true) {
      if (tab.id === undefined) {
        ctx.addIssue({ code: "custom", message: "A deleted tab needs the tab id from get_document." });
      }
      return;
    }
    for (const field of ["name", "position", "content"] as const) {
      if (tab[field] === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `${field} is required on every tab you keep; use _delete: true to remove one.`,
        });
      }
    }
  });

// Resolved by the shared helper, not derived here: this endpoint validates a
// credential's resource against the same value the OAuth flow bound it to, and
// deriving it independently locked out correctly-minted grants whenever APP_URL
// was set without MCP_RESOURCE_URL.
function resourceUrl(request: Request): URL {
  return mcpResourceUrl(request);
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
      const failure = await toolFailure(error);
      if (!failure) throw error;
      audit(toolName, documentId, "error", {
        ...metadata,
        reason: failure.content[0].text.slice(0, 200),
      });
      return failure;
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
          .max(MAX_TABS),
        idempotencyKey: z.string().max(200).optional(),
      },
    },
    async ({ title, tabs, idempotencyKey }) => {
      if (!hasScope(identity, "docs:write")) return toolError("Missing required scope: docs:write");
      return runWrite(
        "create_document",
        null,
        idempotencyKey ?? null,
        { tabCount: tabs.length },
        () =>
          createUserDocument(identity.userId, {
            title,
            tabs: validateNewDocumentTabs(tabs),
          }),
      );
    },
  );

  server.registerTool(
    "update_document",
    {
      description:
        "Replace the title and/or full tab list of an owned document. Requires docs:write. " +
        "Read the document first and pass its current revision as baseRevision. " +
        "This replaces the whole tab list, so include every existing tab — an existing tab " +
        "omitted from `tabs` is not deleted, it is simply left alone. To add, remove or " +
        "edit ONE tab, prefer create_tab, delete_tab, update_tab, or rename_document: " +
        "they need no document read and no resend of the other tabs' content. Reordering " +
        "tabs is only possible here, by writing the whole list with new positions. " +
        CONTENT_TYPE_GUIDE,
      inputSchema: {
        documentId: z.string().regex(DOCUMENT_ID_PATTERN),
        title: z.string().max(500).optional(),
        tabs: z.array(tabWriteSchema).min(1).max(MAX_TABS),
        baseRevision: z.number().int().min(0),
        idempotencyKey: z.string().max(200).optional(),
      },
    },
    async ({ documentId, title, tabs, baseRevision, idempotencyKey }) => {
      if (!hasScope(identity, "docs:write")) return toolError("Missing required scope: docs:write");
      return runWrite(
        "update_document",
        documentId,
        idempotencyKey ?? null,
        { tabCount: tabs.length, hasTitle: title !== undefined },
        () =>
          updateUserDocument(identity.userId, documentId, {
            title,
            // The tool takes `content`/`contentType` like the other write tools;
            // validateSaveTabs() speaks the web editor's `html`/`content_type`.
            // Adapt here rather than loosening the validator both callers share.
            tabs: validateSaveTabs(
              tabs.map((tab) => ({
                ...tab,
                html: tab.content,
                content_type: tab.contentType,
              })),
            ),
            baseRevision,
          }),
      );
    },
  );

  server.registerTool(
    "update_tab",
    {
      description:
        "Update one tab of an owned document by slug. Requires docs:write. " +
        "Read the document first and pass its current revision as baseRevision. " +
        "Omitted fields are left untouched, so a name-only change does not resend the " +
        "tab's content. " +
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
    "create_tab",
    {
      description:
        "Append a new tab to an existing owned document. Requires docs:write. " +
        "Read the document first and pass its current revision as baseRevision. " +
        "This is cheaper and safer than update_document, which would require reading the " +
        "document and resending every existing tab. " +
        CONTENT_TYPE_GUIDE,
      inputSchema: {
        documentId: z.string().regex(DOCUMENT_ID_PATTERN),
        name: z.string().max(200).optional(),
        content: z.string(),
        contentType: contentTypeSchema.optional(),
        baseRevision: z.number().int().min(0),
        idempotencyKey: z.string().max(200).optional(),
      },
    },
    async ({ documentId, name, content, contentType, baseRevision, idempotencyKey }) => {
      if (!hasScope(identity, "docs:write")) return toolError("Missing required scope: docs:write");
      return runWrite(
        "create_tab",
        documentId,
        idempotencyKey ?? null,
        { hasName: name !== undefined },
        () =>
          createUserDocumentTab(identity.userId, documentId, {
            name,
            content,
            contentType,
            baseRevision,
          }),
      );
    },
  );

  server.registerTool(
    "delete_tab",
    {
      description:
        "Delete one tab of an owned document by slug, closing the gap in tab order. " +
        "Requires docs:delete, separately from docs:write. " +
        "Read the document first and pass its current revision as baseRevision. " +
        "A document must keep at least one tab; delete the document instead.",
      inputSchema: {
        documentId: z.string().regex(DOCUMENT_ID_PATTERN),
        tabSlug: z.string().regex(TAB_SLUG_PATTERN),
        baseRevision: z.number().int().min(0),
        idempotencyKey: z.string().max(200).optional(),
      },
    },
    async ({ documentId, tabSlug, baseRevision, idempotencyKey }) => {
      if (!hasScope(identity, "docs:delete")) return toolError("Missing required scope: docs:delete");
      return runWrite(
        "delete_tab",
        documentId,
        idempotencyKey ?? null,
        { tabSlug },
        () => deleteUserDocumentTab(identity.userId, documentId, tabSlug, { baseRevision }),
      );
    },
  );

  server.registerTool(
    "rename_document",
    {
      description:
        "Change the title of an owned document, leaving every tab untouched. Requires " +
        "docs:write. Read the document first and pass its current revision as baseRevision. " +
        "Prefer this over update_document, which requires reading the document and " +
        "resending the content of every tab. An empty title keeps the current one.",
      inputSchema: {
        documentId: z.string().regex(DOCUMENT_ID_PATTERN),
        title: z.string().max(500),
        baseRevision: z.number().int().min(0),
        idempotencyKey: z.string().max(200).optional(),
      },
    },
    async ({ documentId, title, baseRevision, idempotencyKey }) => {
      if (!hasScope(identity, "docs:write")) return toolError("Missing required scope: docs:write");
      return runWrite(
        "rename_document",
        documentId,
        idempotencyKey ?? null,
        {},
        () => renameUserDocument(identity.userId, documentId, { title, baseRevision }),
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
