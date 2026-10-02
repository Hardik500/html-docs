import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  getPostgresPool: vi.fn(),
  getLocalDatabase: vi.fn(),
}));
vi.mock("~/lib/runtime.server", () => ({ isDesktopRuntime: () => false }));

const agentMocks = vi.hoisted(() => ({ authenticateAgentToken: vi.fn() }));
vi.mock("~/lib/agent-tokens.server", () => ({
  authenticateAgentToken: agentMocks.authenticateAgentToken,
  recordAgentEvent: vi.fn(),
  AGENT_SCOPES: ["docs:read", "docs:write", "docs:delete"],
}));
vi.mock("~/lib/ratelimit.server", () => ({ checkMcpRate: vi.fn(async () => true) }));

import { loader as opencodeLoader } from "~/routes/well-known.opencode";
import { loader as resourceLoader } from "~/routes/well-known.oauth-protected-resource.mcp";
import { loader as mcpLoader } from "~/routes/mcp";
import {
  mcpResourceOrigin,
  mcpResourceUrl,
  resourceIdentifier,
} from "~/lib/mcp-resource.server";

/**
 * Builds the loader args a discovery route needs for an absolute URL. These
 * routes read only `request`, so the cast matches the existing route tests
 * rather than restating React Router's full loader-arg type.
 */
function at(url: string) {
  return { request: new Request(url), params: {}, context: {} } as never;
}

/** The request alone, for the resource helpers that take a Request directly. */
function requestAt(url: string) {
  return new Request(url);
}

const ORIGIN = "https://html-docs.example";
const ENV_KEYS = ["APP_URL", "MCP_RESOURCE_URL"] as const;

beforeEach(() => {
  agentMocks.authenticateAgentToken.mockResolvedValue(null);
});

describe("MCP resource identifier", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("falls back to the request origin when nothing is configured", () => {
    expect(mcpResourceOrigin(requestAt(`${ORIGIN}/mcp`))).toBe(ORIGIN);
    expect(resourceIdentifier(requestAt(`${ORIGIN}/mcp`))).toBe(`${ORIGIN}/mcp`);
  });

  it("prefers MCP_RESOURCE_URL over APP_URL", () => {
    process.env.APP_URL = "https://app.example";
    process.env.MCP_RESOURCE_URL = "https://mcp.example/mcp";
    expect(resourceIdentifier(requestAt(`${ORIGIN}/mcp`))).toBe("https://mcp.example/mcp");
  });

  it("uses APP_URL when only that is set", () => {
    process.env.APP_URL = "https://app.example/";
    expect(resourceIdentifier(requestAt(`${ORIGIN}/mcp`))).toBe("https://app.example/mcp");
  });

  it("resolves the same identifier for the endpoint and the discovery document", () => {
    // The regression this guards: these two used to be derived separately, so a
    // token minted over OAuth was bound to APP_URL/mcp while the endpoint
    // compared it against the request origin and refused it as a wrong audience.
    process.env.APP_URL = "https://app.example";
    const preview = "https://preview.vercel.app";
    expect(resourceIdentifier(requestAt(`${preview}/mcp`))).toBe("https://app.example/mcp");
    expect(mcpResourceUrl(requestAt(`${preview}/.well-known/opencode`)).toString())
      .toBe("https://app.example/mcp");
  });
});

describe("GET /.well-known/opencode", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    saved.set("APP_URL", process.env.APP_URL);
    saved.set("MCP_RESOURCE_URL", process.env.MCP_RESOURCE_URL);
    delete process.env.APP_URL;
    delete process.env.MCP_RESOURCE_URL;
  });

  afterEach(() => {
    for (const key of ["APP_URL", "MCP_RESOURCE_URL"] as const) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("serves an opencode config document pointing at the MCP endpoint", async () => {
    const response = opencodeLoader(at(`${ORIGIN}/.well-known/opencode`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const body = await response.json();
    expect(body.$schema).toBe("https://opencode.ai/config.json");
    // opencode validates against its own config schema, where a remote server
    // is type "remote" and lives under `mcp` — not `mcpServers` with type "http".
    expect(body.mcp["html-docs"]).toEqual({
      type: "remote",
      url: `${ORIGIN}/mcp`,
      enabled: false,
    });
  });

  it("advertises disabled by default so it is opt-in", async () => {
    // An enabled-by-default entry would point every visitor at a server they
    // hold no token for, which opencode would surface as a connection failure.
    const body = await opencodeLoader(at(`${ORIGIN}/.well-known/opencode`)).json();
    expect(body.mcp["html-docs"].enabled).toBe(false);
  });

  it("sends no Authorization header, so the client falls through to OAuth", async () => {
    // opencode auto-detects the 401 and runs the OAuth flow, which this app
    // implements. A baked-in header would be wrong anyway: no token is known
    // server-side at this point.
    const body = await opencodeLoader(at(`${ORIGIN}/.well-known/opencode`)).json();
    expect(body.mcp["html-docs"]).not.toHaveProperty("headers");
  });

  it("agrees with the resource identifier OAuth binds tokens to", async () => {
    process.env.APP_URL = "https://app.example";
    const body = await opencodeLoader(at("https://preview.vercel.app/.well-known/opencode")).json();
    expect(body.mcp["html-docs"].url).toBe("https://app.example/mcp");
    // The 401 hint on the MCP endpoint must name the same resource.
    const metadata = await resourceLoader(at("https://preview.vercel.app/.well-known/oauth-protected-resource/mcp")).json();
    expect(metadata.resource).toBe(body.mcp["html-docs"].url);
  });

  it("advertises the resource the endpoint validates against, on every host", async () => {
    // Guards the drift that made this endpoint worth extracting: the OAuth flow
    // binds tokens to APP_URL/mcp, while the endpoint used to compare against
    // its own request origin. On a preview or alternate host a correctly-minted
    // token was then refused by isWrongAudience. This asserts through the
    // endpoint's own public surface rather than re-deriving the value here.
    process.env.APP_URL = "https://app.example";
    const preview = "https://preview.vercel.app";

    const advertised = (await opencodeLoader(at(`${preview}/.well-known/opencode`)).json())
      .mcp["html-docs"].url;
    const challenged = (await resourceLoader(at(`${preview}/.well-known/oauth-protected-resource/mcp`)).json())
      .resource;

    expect(advertised).toBe("https://app.example/mcp");
    expect(advertised).toBe(challenged);

    // And the endpoint must not resolve to the preview host it was reached on.
    expect(advertised).not.toContain("preview.vercel.app");
  });

  it("issues a 401 hint naming the same resource the discovery document advertises", async () => {
    // The end-to-end shape of the drift: the endpoint tells a client which
    // resource to get a token for, and /.well-known/opencode tells it where to
    // connect. If those two ever name different resources, an opted-in client
    // authenticates correctly and is then refused as a wrong audience.
    process.env.APP_URL = "https://app.example";
    const preview = "https://preview.vercel.app";

    // A GET is the wrong verb for this endpoint (it is POST-only), so drive the
    // loader directly with a POST-shaped call to reach the auth challenge.
    const unauthenticated = await mcpLoader({
      request: new Request(`${preview}/mcp`, { method: "POST" }),
      params: {},
      context: {},
    } as never);
    expect(unauthenticated.status).toBe(401);

    // The challenge points at the metadata document rather than the resource
    // itself, so assert where it sends the client and that the document there
    // names the resource the discovery entry advertises.
    const hint = unauthenticated.headers.get("www-authenticate") ?? "";
    expect(hint).toContain('resource_metadata="https://app.example/.well-known/oauth-protected-resource/mcp"');

    const advertised = (await opencodeLoader(at(`${preview}/.well-known/opencode`)).json())
      .mcp["html-docs"].url;
    const challenged = (await resourceLoader(at(`${preview}/.well-known/oauth-protected-resource/mcp`)).json())
      .resource;
    expect(challenged).toBe(advertised);
  });

  it("contains no secrets", async () => {
    const body = await opencodeLoader(at(`${ORIGIN}/.well-known/opencode`)).json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/hdo_|hat_|Bearer |token/i);
  });

  it("is cacheable by shared caches, unlike the agent-token surfaces", async () => {
    const response = opencodeLoader(at(`${ORIGIN}/.well-known/opencode`));
    expect(response.headers.get("cache-control")).toContain("public");
  });
});