import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("~/lib/db.server", () => ({ query: mocks.query }));

import {
  OAuthError,
  base64UrlSha256,
  exchangeAuthorizationCode,
  findClient,
  formatScope,
  isAllowedRedirectUri,
  parseRequestedScopes,
  registerClient,
  refreshAccessToken,
  revokeToken,
  validateAuthorizeRequest,
  validateRedirectUri,
} from "~/lib/oauth.server";

const CLIENT_ID = `mcp_${"a".repeat(32)}`;
const REDIRECT_URI = "http://127.0.0.1:53219/callback";
const VERIFIER = "v".repeat(64);
const CHALLENGE = base64UrlSha256(VERIFIER);
const RESOURCE = "https://html-docs-pink.vercel.app/mcp";

function clientRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "client-pk",
    client_id: CLIENT_ID,
    client_name: "Test client",
    redirect_uris: [REDIRECT_URI],
    revoked_at: null,
    ...overrides,
  };
}

describe("OAuth redirect URI policy", () => {
  it("accepts loopback and https redirects", () => {
    expect(isAllowedRedirectUri("http://127.0.0.1:1234/cb")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:1234/cb")).toBe(false);
    expect(isAllowedRedirectUri("https://app.example.com/cb")).toBe(true);
  });

  it("rejects plaintext remote origins", () => {
    expect(isAllowedRedirectUri("http://app.example.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("https://app.example.com/cb#frag")).toBe(false);
    expect(isAllowedRedirectUri("not a url")).toBe(false);
  });

  it("rejects script-bearing schemes that could steal the code", () => {
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isAllowedRedirectUri("vbscript:msgbox(1)")).toBe(false);
    expect(isAllowedRedirectUri("file:///etc/passwd")).toBe(false);
  });

  it("accepts a native app custom scheme with a callback path", () => {
    expect(isAllowedRedirectUri("myapp://callback")).toBe(true);
    expect(isAllowedRedirectUri("myapp:/callback")).toBe(true);
  });

  it("reports a usable error for an invalid redirect", () => {
    expect(() => validateRedirectUri("http://evil.example/cb")).toThrow(OAuthError);
    try {
      validateRedirectUri("http://evil.example/cb");
    } catch (error) {
      expect((error as OAuthError).errorCode).toBe("invalid_request");
    }
  });
});

describe("OAuth scope parsing", () => {
  it("keeps only supported scopes and drops duplicates", () => {
    expect(parseRequestedScopes("docs:read docs:write docs:read")).toEqual(["docs:read", "docs:write"]);
  });

  it("rejects an empty or fully unsupported scope list", () => {
    expect(() => parseRequestedScopes("admin:everything")).toThrow(OAuthError);
    expect(() => parseRequestedScopes("")).toThrow(OAuthError);
  });

  it("round trips through the wire format", () => {
    expect(formatScope(parseRequestedScopes("docs:read docs:delete"))).toBe("docs:read docs:delete");
  });
});

describe("OAuth dynamic client registration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers a public client with no secret", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const client = await registerClient({
      clientName: "My agent",
      redirectUris: [REDIRECT_URI],
    });
    expect(client.clientId).toMatch(/^mcp_[A-Za-z0-9_-]{43}$/);
    expect(client).not.toHaveProperty("clientSecret");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_oauth_clients"),
      [client.clientId, "My agent", [REDIRECT_URI]],
    );
  });

  it("refuses to register an insecure remote redirect", async () => {
    await expect(
      registerClient({ clientName: "x", redirectUris: ["http://evil.example/cb"] }),
    ).rejects.toMatchObject({ errorCode: "invalid_request" });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

describe("OAuth authorization request validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [clientRow()] });
  });

  const params = (overrides: Record<string, string> = {}) =>
    new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "docs:read docs:write",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      state: "xyz",
      ...overrides,
    });

  it("accepts a well-formed PKCE request", async () => {
    const pending = await validateAuthorizeRequest(params());
    expect(pending.scopes).toEqual(["docs:read", "docs:write"]);
    expect(pending.state).toBe("xyz");
  });

  it("requires S256 and rejects plaintext code_challenge_method", async () => {
    await expect(
      validateAuthorizeRequest(params({ code_challenge_method: "plain" })),
    ).rejects.toMatchObject({ errorCode: "invalid_request" });
  });

  it("rejects an unregistered redirect even for a valid client", async () => {
    await expect(
      validateAuthorizeRequest(params({ redirect_uri: "http://127.0.0.1:9999/other" })),
    ).rejects.toMatchObject({ errorCode: "invalid_request" });
  });

  it("rejects an unknown client before touching the redirect", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await expect(validateAuthorizeRequest(params())).rejects.toMatchObject({
      errorCode: "invalid_client",
    });
  });

  it("rejects a revoked client", async () => {
    mocks.query.mockResolvedValue({ rows: [clientRow({ revoked_at: new Date().toISOString() })] });
    await expect(validateAuthorizeRequest(params())).rejects.toMatchObject({
      errorCode: "invalid_client",
    });
  });

  it("refuses implicit or hybrid flows", async () => {
    await expect(
      validateAuthorizeRequest(params({ response_type: "token" })),
    ).rejects.toMatchObject({ errorCode: "unsupported_response_type" });
  });

  it("reports unsupported scopes as invalid_scope", async () => {
    await expect(
      validateAuthorizeRequest(params({ scope: "admin:all" })),
    ).rejects.toMatchObject({ errorCode: "invalid_scope" });
  });
});

describe("OAuth authorization code exchange", () => {
  const code = `hac_${"c".repeat(43)}`;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockImplementation(async (sql: string) => {
      if (/FROM agent_oauth_clients/.test(sql)) return { rows: [clientRow()] };
      if (/FROM agent_oauth_authorization_codes/.test(sql)) {
        return {
          rows: [
            {
              code_hash: "hash",
              client_pk: "client-pk",
              client_id: CLIENT_ID,
              redirect_uris: [REDIRECT_URI],
              user_id: "user-1",
              redirect_uri: REDIRECT_URI,
              scope: "docs:read docs:write",
              code_challenge: CHALLENGE,
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

  const exchange = (overrides: Record<string, unknown> = {}) =>
    exchangeAuthorizationCode({
      code,
      codeVerifier: VERIFIER,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      resource: RESOURCE,
      ...overrides,
    });

  it("issues access and refresh tokens for a valid code", async () => {
    const grant = await exchange();
    expect(grant.accessToken).toMatch(/^hat_[A-Za-z0-9_-]{43}$/);
    expect(grant.refreshToken).toMatch(/^hrt_[A-Za-z0-9_-]{43}$/);
    expect(grant.scopes).toEqual(["docs:read", "docs:write"]);
    expect(grant.expiresIn).toBe(3600);

    // The access token must be bound to this resource and stored hashed.
    const insert = mocks.query.mock.calls.find(([sql]) => /INSERT INTO agent_access_tokens/.test(sql));
    expect(insert?.[1]).toEqual(expect.arrayContaining([RESOURCE, "client-pk"]));
    expect(JSON.stringify(insert?.[1])).not.toContain(grant.accessToken);
  });

  it("marks the code used so it cannot be replayed", async () => {
    await exchange();
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("SET used_at = now()"),
      ["hash"],
    );
  });

  it("rejects a reused code", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (/FROM agent_oauth_clients/.test(sql)) return { rows: [clientRow()] };
      if (/FROM agent_oauth_authorization_codes/.test(sql)) {
        return {
          rows: [
            {
              code_hash: "hash",
              client_pk: "client-pk",
              client_id: CLIENT_ID,
              redirect_uris: [REDIRECT_URI],
              user_id: "user-1",
              redirect_uri: REDIRECT_URI,
              scope: "docs:read",
              code_challenge: CHALLENGE,
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              used_at: new Date().toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    });
    await expect(exchange()).rejects.toMatchObject({ errorCode: "invalid_grant" });
  });

  it("rejects an expired code", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (/FROM agent_oauth_clients/.test(sql)) return { rows: [clientRow()] };
      if (/FROM agent_oauth_authorization_codes/.test(sql)) {
        return {
          rows: [
            {
              code_hash: "hash",
              client_pk: "client-pk",
              client_id: CLIENT_ID,
              redirect_uris: [REDIRECT_URI],
              user_id: "user-1",
              redirect_uri: REDIRECT_URI,
              scope: "docs:read",
              code_challenge: CHALLENGE,
              expires_at: new Date(Date.now() - 1_000).toISOString(),
              used_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    await expect(exchange()).rejects.toMatchObject({ errorCode: "invalid_grant" });
  });

  it("rejects a wrong PKCE verifier", async () => {
    await expect(exchange({ codeVerifier: "w".repeat(64) })).rejects.toMatchObject({
      errorCode: "invalid_grant",
    });
  });

  it("rejects a mismatched redirect_uri", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (/FROM agent_oauth_clients/.test(sql)) {
        return { rows: [clientRow({ redirect_uris: [REDIRECT_URI, "http://127.0.0.1:1/other"] })] };
      }
      if (/FROM agent_oauth_authorization_codes/.test(sql)) {
        return {
          rows: [
            {
              code_hash: "hash",
              client_pk: "client-pk",
              client_id: CLIENT_ID,
              redirect_uris: [REDIRECT_URI],
              user_id: "user-1",
              redirect_uri: REDIRECT_URI,
              scope: "docs:read",
              code_challenge: CHALLENGE,
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              used_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    await expect(exchange({ redirectUri: "http://127.0.0.1:1/other" })).rejects.toMatchObject({
      errorCode: "invalid_grant",
    });
  });

  it("refuses a code presented by a different client", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (/FROM agent_oauth_clients/.test(sql)) return { rows: [clientRow({ id: "other-pk" })] };
      if (/FROM agent_oauth_authorization_codes/.test(sql)) {
        return {
          rows: [
            {
              code_hash: "hash",
              client_pk: "client-pk",
              client_id: CLIENT_ID,
              redirect_uris: [REDIRECT_URI],
              user_id: "user-1",
              redirect_uri: REDIRECT_URI,
              scope: "docs:read",
              code_challenge: CHALLENGE,
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              used_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    await expect(exchange()).rejects.toMatchObject({ errorCode: "invalid_grant" });
  });
});

describe("OAuth refresh token rotation", () => {
  const refreshToken = `hrt_${"r".repeat(43)}`;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockImplementation(async (sql: string) => {
      if (/FROM agent_oauth_clients/.test(sql)) return { rows: [clientRow()] };
      if (/FROM agent_oauth_refresh_tokens/.test(sql)) {
        return {
          rows: [
            {
              id: "refresh-1",
              user_id: "user-1",
              client_pk: "client-pk",
              scope: "docs:read",
              access_token_id: "access-old",
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              used_at: null,
              revoked_at: null,
            },
          ],
        };
      }
      if (/INSERT INTO agent_access_tokens/.test(sql)) return { rows: [{ id: "access-new" }] };
      return { rows: [] };
    });
  });

  it("rotates the refresh token and retires the old access token", async () => {
    const grant = await refreshAccessToken({
      refreshToken,
      clientId: CLIENT_ID,
      resource: RESOURCE,
    });
    expect(grant.accessToken).toMatch(/^hat_/);
    expect(grant.refreshToken).toMatch(/^hrt_/);
    expect(grant.refreshToken).not.toBe(refreshToken);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("SET revoked_at = now()"),
      ["access-old"],
    );
  });

  it("revokes the entire grant when a rotated token is replayed", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (/FROM agent_oauth_clients/.test(sql)) return { rows: [clientRow()] };
      if (/FROM agent_oauth_refresh_tokens/.test(sql)) {
        return {
          rows: [
            {
              id: "refresh-1",
              user_id: "user-1",
              client_pk: "client-pk",
              scope: "docs:read",
              access_token_id: "access-old",
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              used_at: new Date().toISOString(),
              revoked_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      refreshAccessToken({ refreshToken, clientId: CLIENT_ID, resource: RESOURCE }),
    ).rejects.toMatchObject({ errorCode: "invalid_grant" });

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE agent_oauth_grants SET revoked_at"),
      ["user-1", "client-pk"],
    );
  });
});

describe("OAuth revocation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revokes an access token by hash", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await revokeToken(`hat_${"a".repeat(43)}`);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE agent_access_tokens SET revoked_at"),
      [expect.stringMatching(/^[a-f0-9]{64}$/)],
    );
  });

  it("revokes the whole grant when a refresh token is presented", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (/SELECT user_id, client_pk/.test(sql)) {
        return { rows: [{ user_id: "user-1", client_pk: "client-pk" }] };
      }
      return { rows: [] };
    });
    await revokeToken(`hrt_${"a".repeat(43)}`);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE agent_oauth_grants SET revoked_at"),
      ["user-1", "client-pk"],
    );
  });

  it("ignores an unrecognized token without a database write", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await revokeToken("not-a-token");
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

describe("OAuth client lookup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a malformed client_id without querying", async () => {
    await expect(findClient("short")).rejects.toMatchObject({ errorCode: "invalid_client" });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
