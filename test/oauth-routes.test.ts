import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("~/lib/db.server", () => ({ query: mocks.query }));
vi.mock("~/lib/runtime.server", () => ({ isDesktopRuntime: () => false }));

import { loader as protectedResourceLoader } from "~/routes/well-known.oauth-protected-resource";
import { loader as protectedResourceMcpLoader } from "~/routes/well-known.oauth-protected-resource.mcp";
import { loader as authorizationServerLoader } from "~/routes/well-known.oauth-authorization-server";
import { loader as openidLoader } from "~/routes/well-known.openid-configuration";
import { action as registerAction, loader as registerLoader } from "~/routes/oauth.register";
import { action as tokenAction, loader as tokenLoader } from "~/routes/oauth.token";
import { action as revokeAction } from "~/routes/oauth.revoke";
import { base64UrlSha256 } from "~/lib/oauth.server";

const ORIGIN = "https://html-docs-pink.vercel.app";

function getRequest(url: string) {
  return new Request(url) as never;
}

describe("MCP OAuth discovery metadata", () => {
  it("publishes protected resource metadata for /mcp", async () => {
    const response = protectedResourceMcpLoader({
      request: getRequest(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`),
      params: {},
      context: {},
    } as never);
    const body = await response.json();

    expect(body.resource).toBe(`${ORIGIN}/mcp`);
    expect(body.authorization_servers).toEqual([ORIGIN]);
    expect(body.bearer_methods_supported).toEqual(["header"]);
    expect(body.scopes_supported).toEqual(["docs:read", "docs:write", "docs:delete"]);
    expect(response.headers.get("cache-control")).toContain("max-age");
  });

  it("serves the same document at the short path", async () => {
    const response = protectedResourceLoader({
      request: getRequest(`${ORIGIN}/.well-known/oauth-protected-resource`),
      params: {},
      context: {},
    } as never);
    expect((await response.json()).resource).toBe(`${ORIGIN}/mcp`);
  });

  it("publishes authorization server metadata with PKCE only", async () => {
    const response = authorizationServerLoader({
      request: getRequest(`${ORIGIN}/.well-known/oauth-authorization-server`),
      params: {},
      context: {},
    } as never);
    const body = await response.json();

    expect(body.issuer).toBe(ORIGIN);
    expect(body.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`);
    expect(body.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
    expect(body.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
    expect(body.revocation_endpoint).toBe(`${ORIGIN}/oauth/revoke`);
    expect(body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(body.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    // Public clients only: advertising a secret method would invite a
    // confidential-client flow the server does not implement.
    expect(body.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });

  it("aliases the openid-configuration path to the same metadata", async () => {
    const response = openidLoader({
      request: getRequest(`${ORIGIN}/.well-known/openid-configuration`),
      params: {},
      context: {},
    } as never);
    expect((await response.json()).token_endpoint).toBe(`${ORIGIN}/oauth/token`);
  });
});

describe("MCP dynamic client registration route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [] });
  });

  const register = (body: unknown) =>
    registerAction({
      request: new Request(`${ORIGIN}/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }) as never,
      params: {},
      context: {},
    } as never);

  it("registers a public client and returns no secret", async () => {
    const response = await register({
      client_name: "Agent",
      redirect_uris: ["http://127.0.0.1:4000/cb"],
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.client_id).toMatch(/^mcp_/);
    expect(body.client_secret).toBeUndefined();
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects an insecure redirect with an RFC error body", async () => {
    const response = await register({
      client_name: "Agent",
      redirect_uris: ["http://evil.example/cb"],
    });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_request");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejects a request with no redirect_uris", async () => {
    const response = await register({ client_name: "Agent" });
    expect((await response.json()).error).toBe("invalid_redirect_uri");
  });

  it("rejects a malformed body", async () => {
    const response = await registerAction({
      request: new Request(`${ORIGIN}/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }) as never,
      params: {},
      context: {},
    } as never);
    expect((await response.json()).error).toBe("invalid_request");
  });

  it("refuses GET", () => {
    const response = registerLoader();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});

describe("MCP token endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockImplementation(async (sql: string) => {
      if (/FROM agent_oauth_clients/.test(sql)) {
        return {
          rows: [
            {
              id: "client-pk",
              client_id: `mcp_${"a".repeat(43)}`,
              client_name: "Agent",
              redirect_uris: ["http://127.0.0.1:4000/cb"],
              revoked_at: null,
            },
          ],
        };
      }
      if (/FROM agent_oauth_authorization_codes/.test(sql)) {
        return {
          rows: [
            {
              code_hash: "h",
              client_pk: "client-pk",
              client_id: `mcp_${"a".repeat(43)}`,
              redirect_uris: ["http://127.0.0.1:4000/cb"],
              user_id: "user-1",
              redirect_uri: "http://127.0.0.1:4000/cb",
              scope: "docs:read",
              code_challenge: base64UrlSha256("v".repeat(64)),
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              used_at: null,
            },
          ],
        };
      }
      if (/INSERT INTO agent_access_tokens/.test(sql)) return { rows: [{ id: "access-1" }] };
      return { rows: [] };
    });
  });

  const post = (params: Record<string, string>) =>
    tokenAction({
      request: new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
      }) as never,
      params: {},
      context: {},
    } as never);

  it("exchanges an authorization code for tokens", async () => {
    const response = await post({
      grant_type: "authorization_code",
      code: `hac_${"c".repeat(43)}`,
      code_verifier: "v".repeat(64),
      client_id: `mcp_${"a".repeat(43)}`,
      redirect_uri: "http://127.0.0.1:4000/cb",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.token_type).toBe("Bearer");
    expect(body.access_token).toMatch(/^hat_/);
    expect(body.refresh_token).toMatch(/^hrt_/);
    expect(body.scope).toBe("docs:read");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns an OAuth error body for a bad code", async () => {
    const response = await post({
      grant_type: "authorization_code",
      code: "nope",
      code_verifier: "v".repeat(64),
      client_id: `mcp_${"a".repeat(43)}`,
      redirect_uri: "http://127.0.0.1:4000/cb",
    });
    expect((await response.json()).error).toBe("invalid_grant");
  });

  it("rejects an unsupported grant type", async () => {
    const response = await post({ grant_type: "password", username: "a", password: "b" });
    const body = await response.json();
    expect(body.error).toBe("unsupported_grant_type");
    expect(response.status).toBe(400);
  });

  it("never redirects on error", async () => {
    const response = await post({ grant_type: "authorization_code", code: "bad" });
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("refuses GET", () => {
    const response = tokenLoader();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});

describe("MCP revocation endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [] });
  });

  it("always answers 200 so it cannot probe token validity", async () => {
    const response = await revokeAction({
      request: new Request(`${ORIGIN}/oauth/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "token=hat_unknown",
      }) as never,
      params: {},
      context: {},
    } as never);
    expect(response.status).toBe(200);
  });
});
