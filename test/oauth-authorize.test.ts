import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getUserId: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({ query: mocks.query }));
vi.mock("~/lib/auth.server", () => ({ getUserId: mocks.getUserId }));
vi.mock("~/lib/runtime.server", () => ({ isDesktopRuntime: () => false }));

import { action, loader } from "~/routes/oauth.authorize";
import { base64UrlSha256 } from "~/lib/oauth.server";

const ORIGIN = "https://html-docs.example";
const CLIENT_ID = `mcp_${"a".repeat(43)}`;
const REDIRECT_URI = "http://127.0.0.1:51237/cb";
const CHALLENGE = base64UrlSha256("v".repeat(64));

function authorizeRequest(overrides: Record<string, string> = {}) {
  const url = new URL(`${ORIGIN}/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "docs:read",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "xyz",
    ...overrides,
  }).toString();
  return new Request(url) as never;
}

function clientRow() {
  return {
    id: "client-pk",
    client_id: CLIENT_ID,
    client_name: "Test client",
    redirect_uris: [REDIRECT_URI],
    revoked_at: null,
  };
}

const args = (request: unknown) =>
  ({ request, params: {}, context: {} }) as never;

/** The loader returns either a redirect Response or the consent view data. */
type ConsentData = {
  clientName: string;
  clientId: string;
  scopes: string[];
  state: string | null;
  codeChallenge: string;
};

describe("OAuth authorization endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockImplementation(async (sql: string) => {
      if (/FROM agent_oauth_clients/.test(sql)) return { rows: [clientRow()] };
      return { rows: [] };
    });
    mocks.getUserId.mockResolvedValue(null);
  });

  it("accepts a client_id produced by the registration endpoint", async () => {
    // The authorize path must accept exactly what registerClient hands out.
    const { registerClient } = await import("~/lib/oauth.server");
    mocks.query.mockResolvedValueOnce({ rows: [] });
    const client = await registerClient({
      clientName: "Round trip",
      redirectUris: [REDIRECT_URI],
    });
    mocks.query.mockResolvedValue({
      rows: [{ ...clientRow(), client_id: client.clientId }],
    });
    mocks.getUserId.mockResolvedValue("user-1");

    const data = (await loader(
      args(authorizeRequest({ client_id: client.clientId })),
    )) as ConsentData;
    expect(data.clientId).toBe(client.clientId);
  });

  it("sends a signed-out user to sign-in, preserving the request", async () => {
    const response = (await loader(args(authorizeRequest()))) as Response;
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") as string);
    expect(location.pathname).toBe("/auth/magic");
    const redirect = location.searchParams.get("redirect");
    expect(redirect).toMatch(/^\/oauth\/authorize\?/);
    // Every authorization parameter must survive the sign-in round trip.
    expect(new URL(redirect as string, ORIGIN).searchParams.get("code_challenge")).toBe(CHALLENGE);
    expect(new URL(redirect as string, ORIGIN).searchParams.get("client_id")).toBe(CLIENT_ID);
  });

  it("shows the consent screen to a signed-in user", async () => {
    mocks.getUserId.mockResolvedValue("user-1");
    const data = (await loader(args(authorizeRequest()))) as ConsentData;
    expect(data).toMatchObject({
      clientName: "Test client",
      scopes: ["docs:read"],
      state: "xyz",
      codeChallenge: CHALLENGE,
    });
  });

  it("refuses to redirect to an unregistered URI", async () => {
    await expect(
      loader(args(authorizeRequest({ redirect_uri: "http://127.0.0.1:9999/evil" }))),
    ).rejects.toBeInstanceOf(Response);
  });

  it("returns an error redirect to the client for a bad PKCE method", async () => {
    const response = (await loader(
      args(authorizeRequest({ code_challenge_method: "plain" })),
    )) as Response;
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") as string);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get("error")).toBe("invalid_request");
    expect(location.searchParams.get("state")).toBe("xyz");
  });

  it("issues a code and returns it to the registered redirect", async () => {
    mocks.getUserId.mockResolvedValue("user-1");
    const form = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "docs:read",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      state: "xyz",
      decision: "allow",
    });
    const response = await action(
      args(new Request(`${ORIGIN}/oauth/authorize`, { method: "POST", body: form }) as never),
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") as string);
    expect(location.searchParams.get("code")).toMatch(/^hac_/);
    expect(location.searchParams.get("state")).toBe("xyz");
  });

  it("returns access_denied to the client when the user declines", async () => {
    mocks.getUserId.mockResolvedValue("user-1");
    const form = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "docs:read",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      state: "xyz",
      decision: "deny",
    });
    const response = await action(
      args(new Request(`${ORIGIN}/oauth/authorize`, { method: "POST", body: form }) as never),
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") as string);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("xyz");
  });

  it("requires a signed-in user to approve", async () => {
    mocks.getUserId.mockResolvedValue(null);
    const form = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "docs:read",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      decision: "allow",
    });
    await expect(
      action(args(new Request(`${ORIGIN}/oauth/authorize`, { method: "POST", body: form }) as never)),
    ).rejects.toBeInstanceOf(Response);
  });
});
