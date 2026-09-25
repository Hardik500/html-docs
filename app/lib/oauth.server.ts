import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { query } from "./db.server";
import { AGENT_SCOPES, type AgentScope } from "./agent-tokens.server";

/**
 * OAuth 2.1 authorization for the MCP endpoint.
 *
 * Supports public clients only: dynamic client registration, PKCE (S256) with
 * no client secret, authorization codes, and rotating refresh tokens. Access
 * tokens are opaque and stored hashed in `agent_access_tokens`, so revoking a
 * grant takes effect immediately.
 */

export const AUTHORIZATION_CODE_TTL_SECONDS = 300;
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

// randomBytes(32).toString("base64url") yields 43 characters, so every
// generated token pattern below must be 43 — not the 32-byte input length.
const CLIENT_ID_PATTERN = /^mcp_[A-Za-z0-9_-]{43}$/;
const AUTHORIZATION_CODE_PATTERN = /^hac_[A-Za-z0-9_-]{43}$/;
const ACCESS_TOKEN_PATTERN = /^hat_[A-Za-z0-9_-]{43}$/;
const REFRESH_TOKEN_PATTERN = /^hrt_[A-Za-z0-9_-]{43}$/;

export class OAuthError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly redirectUri: string | null;
  readonly state: string | null;

  constructor(
    errorCode: string,
    description: string,
    status = 400,
    redirectUri: string | null = null,
    state: string | null = null,
  ) {
    super(description);
    this.name = "OAuthError";
    this.errorCode = errorCode;
    this.status = status;
    this.redirectUri = redirectUri;
    this.state = state;
  }
}

function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function base64UrlSha256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ── Resource and issuer URLs ────────────────────────────────────────────────

function originOf(request: Request): string {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

export function resourceIdentifier(request: Request): string {
  const configured = process.env.MCP_RESOURCE_URL;
  if (configured) return configured;
  return `${originOf(request)}/mcp`;
}

export interface IssuerEndpoints {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint: string;
  resource: string;
}

export function issuerEndpoints(request: Request): IssuerEndpoints {
  const issuer = originOf(request);
  return {
    issuer,
    authorizationEndpoint: `${issuer}/oauth/authorize`,
    tokenEndpoint: `${issuer}/oauth/token`,
    registrationEndpoint: `${issuer}/oauth/register`,
    revocationEndpoint: `${issuer}/oauth/revoke`,
    resource: resourceIdentifier(request),
  };
}

// ── Discovery metadata ───────────────────────────────────────────────────────

/** RFC 9728 metadata. MCP clients read this from the endpoint's 401 hint. */
export function protectedResourceMetadata(request: Request): Record<string, unknown> {
  const { issuer, resource } = issuerEndpoints(request);
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [...AGENT_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "html-docs",
  };
}

/** RFC 8414 metadata, restricted to the public-client PKCE flow. */
export function authorizationServerMetadata(request: Request): Record<string, unknown> {
  const endpoints = issuerEndpoints(request);
  return {
    issuer: endpoints.issuer,
    authorization_endpoint: endpoints.authorizationEndpoint,
    token_endpoint: endpoints.tokenEndpoint,
    registration_endpoint: endpoints.registrationEndpoint,
    revocation_endpoint: endpoints.revocationEndpoint,
    scopes_supported: [...AGENT_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    service_documentation: `${endpoints.issuer}/dashboard/agents`,
  };
}

// ── Scope handling ───────────────────────────────────────────────────────────

export function parseRequestedScopes(value: unknown): AgentScope[] {
  const raw = typeof value === "string" ? value : Array.isArray(value) ? value.join(" ") : "";
  const requested = raw.split(/[\s+]+/).filter(Boolean);
  const scopes = [...new Set(requested.filter((scope): scope is AgentScope =>
    (AGENT_SCOPES as readonly string[]).includes(scope),
  ))];
  if (!scopes.length) throw new OAuthError("invalid_scope", "At least one supported scope is required.");
  return scopes;
}

export function formatScope(scopes: AgentScope[]): string {
  return scopes.join(" ");
}

// ── Redirect URI and client validation ──────────────────────────────────────

/**
 * Schemes that must never be accepted as a redirect target. A registered
 * `javascript:` or `data:` redirect would let an attacker collect an
 * authorization code by scripting the redirect back.
 */
const FORBIDDEN_REDIRECT_SCHEMES = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "blob:",
  "file:",
  "about:",
]);

/**
 * OAuth 2.1 permits loopback redirects on any port, and native-app custom
 * schemes. Everything else must be HTTPS and must match a registered URI
 * exactly.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.hash) return false;
  if (FORBIDDEN_REDIRECT_SCHEMES.has(parsed.protocol.toLowerCase())) return false;

  const isLoopback =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || parsed.hostname === "::1";
  if (isLoopback && (parsed.protocol === "http:" || parsed.protocol === "https:")) return true;
  if (parsed.protocol === "https:") return true;
  // Native app custom scheme, e.g. myapp://callback or myapp:/callback. The
  // scheme itself identifies the app, so only the script-bearing schemes above
  // need to be excluded. http/https are already handled by the rules above,
  // where a non-loopback plaintext origin is rejected.
  if (parsed.protocol === "http:" || parsed.protocol === "https:") return false;
  return /^[a-z][a-z0-9+.-]*:$/i.test(parsed.protocol);
}

export function validateRedirectUri(uri: unknown): string {
  if (typeof uri !== "string" || !uri) {
    throw new OAuthError("invalid_request", "redirect_uri is required");
  }
  if (!isAllowedRedirectUri(uri)) {
    throw new OAuthError("invalid_request", "redirect_uri must be an https or loopback URI without a fragment");
  }
  return uri;
}

// ── Dynamic client registration ──────────────────────────────────────────────

export interface RegisteredClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  issuedAt: number;
}

export async function registerClient(
  input: { clientName?: unknown; redirectUris?: unknown },
): Promise<RegisteredClient> {
  const clientName = typeof input.clientName === "string" && input.clientName.trim()
    ? input.clientName.trim().slice(0, 200)
    : "MCP client";
  if (!Array.isArray(input.redirectUris) || input.redirectUris.length === 0) {
    throw new OAuthError("invalid_redirect_uri", "redirect_uris must contain at least one URI");
  }
  if (input.redirectUris.length > 10) {
    throw new OAuthError("invalid_redirect_uri", "Too many redirect_uris");
  }
  const redirectUris = input.redirectUris.map(validateRedirectUri);

  const clientId = randomToken("mcp");
  await query(
    `INSERT INTO agent_oauth_clients (client_id, client_name, redirect_uris)
     VALUES ($1, $2, $3)`,
    [clientId, clientName, redirectUris],
  );

  return { clientId, clientName, redirectUris, issuedAt: Math.floor(Date.now() / 1000) };
}

interface ClientRow {
  id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  revoked_at: string | null;
}

export async function findClient(clientId: unknown): Promise<ClientRow> {
  if (typeof clientId !== "string" || !CLIENT_ID_PATTERN.test(clientId)) {
    throw new OAuthError("invalid_client", "Unknown client_id");
  }
  const result = await query<ClientRow>(
    `SELECT id, client_id, client_name, redirect_uris, revoked_at
       FROM agent_oauth_clients
      WHERE client_id = $1`,
    [clientId],
  );
  const client = result.rows[0];
  if (!client || client.revoked_at) {
    throw new OAuthError("invalid_client", "Unknown or revoked client_id");
  }
  return client;
}

function assertRegisteredRedirect(client: ClientRow, redirectUri: string): void {
  if (!client.redirect_uris.includes(redirectUri)) {
    throw new OAuthError("invalid_request", "redirect_uri is not registered for this client");
  }
}

// ── Authorization codes ─────────────────────────────────────────────────────

export interface AuthorizeRequest {
  client: ClientRow;
  redirectUri: string;
  scopes: AgentScope[];
  state: string | null;
  codeChallenge: string;
}

export async function validateAuthorizeRequest(params: URLSearchParams): Promise<AuthorizeRequest> {
  const client = await findClient(params.get("client_id"));

  // RFC 6749: only redirect once the client and redirect URI are trustworthy.
  const redirectUri = validateRedirectUri(params.get("redirect_uri"));
  assertRegisteredRedirect(client, redirectUri);

  const state = params.get("state");
  if (params.get("response_type") !== "code") {
    throw new OAuthError("unsupported_response_type", "Only the authorization code flow is supported", 400, redirectUri, state);
  }
  if (params.get("code_challenge_method") !== "S256") {
    throw new OAuthError("invalid_request", "code_challenge_method must be S256", 400, redirectUri, state);
  }
  const codeChallenge = params.get("code_challenge") ?? "";
  if (codeChallenge.length < 43 || codeChallenge.length > 128) {
    throw new OAuthError("invalid_request", "A valid PKCE code_challenge is required", 400, redirectUri, state);
  }

  let scopes: AgentScope[];
  try {
    scopes = parseRequestedScopes(params.get("scope"));
  } catch (error) {
    if (error instanceof OAuthError) {
      throw new OAuthError(error.errorCode, error.message, 400, redirectUri, state);
    }
    throw error;
  }

  return { client, redirectUri, scopes, state, codeChallenge };
}

export async function issueAuthorizationCode(
  request: AuthorizeRequest,
  userId: string,
): Promise<string> {
  const code = randomToken("hac");
  await query(
    `INSERT INTO agent_oauth_authorization_codes
       (code_hash, client_pk, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'S256', now() + ($7 || ' seconds')::interval)`,
    [
      hashOpaqueToken(code),
      request.client.id,
      userId,
      request.redirectUri,
      formatScope(request.scopes),
      request.codeChallenge,
      String(AUTHORIZATION_CODE_TTL_SECONDS),
    ],
  );
  return code;
}

interface CodeRow {
  code_hash: string;
  client_pk: string;
  client_id: string;
  redirect_uris: string[];
  user_id: string;
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  expires_at: string;
  used_at: string | null;
}

export async function exchangeAuthorizationCode(input: {
  code: unknown;
  codeVerifier: unknown;
  clientId: unknown;
  redirectUri: unknown;
  resource: string;
}): Promise<{ userId: string; clientPk: string; scopes: AgentScope[]; accessToken: string; refreshToken: string; expiresIn: number }> {
  const code = input.code;
  if (typeof code !== "string" || !AUTHORIZATION_CODE_PATTERN.test(code)) {
    throw new OAuthError("invalid_grant", "Unknown authorization code");
  }
  const verifier = input.codeVerifier;
  if (typeof verifier !== "string" || verifier.length < 43 || verifier.length > 128) {
    throw new OAuthError("invalid_grant", "A valid PKCE code_verifier is required");
  }

  const client = await findClient(input.clientId);
  const redirectUri = validateRedirectUri(input.redirectUri);
  assertRegisteredRedirect(client, redirectUri);

  const result = await query<CodeRow>(
    `SELECT c.code_hash, c.client_pk, c.user_id, c.redirect_uri, c.scope,
            c.code_challenge, c.expires_at, c.used_at, cl.client_id, cl.redirect_uris
       FROM agent_oauth_authorization_codes c
       JOIN agent_oauth_clients cl ON cl.id = c.client_pk
      WHERE c.code_hash = $1
      FOR UPDATE OF c`,
    [hashOpaqueToken(code)],
  );
  const row = result.rows[0];
  if (!row) throw new OAuthError("invalid_grant", "Unknown authorization code");
  if (row.used_at) throw new OAuthError("invalid_grant", "Authorization code was already used");
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new OAuthError("invalid_grant", "Authorization code has expired");
  }
  if (row.client_pk !== client.id) {
    throw new OAuthError("invalid_grant", "Authorization code was issued to a different client");
  }
  if (row.redirect_uri !== redirectUri) {
    throw new OAuthError("invalid_grant", "redirect_uri does not match the authorization request");
  }
  if (!safeEqual(base64UrlSha256(verifier), row.code_challenge)) {
    throw new OAuthError("invalid_grant", "PKCE verification failed");
  }

  // Single-use enforcement. The row is locked, so concurrent redemptions
  // serialize and the second one observes used_at.
  await query(
    "UPDATE agent_oauth_authorization_codes SET used_at = now() WHERE code_hash = $1",
    [row.code_hash],
  );

  const scopes = parseRequestedScopes(row.scope);
  const accessToken = randomToken("hat");
  const refreshToken = randomToken("hrt");

  const access = await query<{ id: string }>(
    `INSERT INTO agent_access_tokens
       (user_id, name, token_hash, token_prefix, scopes, expires_at, credential_type, resource, client_id)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval, 'oauth', $7, $8)
     RETURNING id`,
    [
      row.user_id,
      client.client_name,
      hashOpaqueToken(accessToken),
      accessToken.slice(0, 12),
      scopes,
      String(ACCESS_TOKEN_TTL_SECONDS),
      input.resource,
      client.id,
    ],
  );

  await query(
    `INSERT INTO agent_oauth_refresh_tokens
       (token_hash, user_id, client_pk, scope, access_token_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)`,
    [
      hashOpaqueToken(refreshToken),
      row.user_id,
      client.id,
      formatScope(scopes),
      access.rows[0].id,
      String(REFRESH_TOKEN_TTL_SECONDS),
    ],
  );

  await query("UPDATE agent_oauth_clients SET last_used_at = now() WHERE id = $1", [client.id]);
  await query(
    `INSERT INTO agent_oauth_grants (user_id, client_pk, scope)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, client_pk) DO UPDATE
        SET scope = EXCLUDED.scope, revoked_at = NULL`,
    [row.user_id, client.id, formatScope(scopes)],
  );

  return {
    userId: row.user_id,
    clientPk: client.id,
    scopes,
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

// ── Refresh and revocation ───────────────────────────────────────────────────

interface RefreshRow {
  id: string;
  user_id: string;
  client_pk: string;
  scope: string;
  access_token_id: string | null;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

export async function refreshAccessToken(input: {
  refreshToken: unknown;
  clientId: unknown;
  resource: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; scopes: AgentScope[] }> {
  const token = input.refreshToken;
  if (typeof token !== "string" || !REFRESH_TOKEN_PATTERN.test(token)) {
    throw new OAuthError("invalid_grant", "Unknown refresh token");
  }
  const client = await findClient(input.clientId);

  const result = await query<RefreshRow>(
    `SELECT id, user_id, client_pk, scope, access_token_id, expires_at, used_at, revoked_at
       FROM agent_oauth_refresh_tokens
      WHERE token_hash = $1
      FOR UPDATE`,
    [hashOpaqueToken(token)],
  );
  const row = result.rows[0];
  if (!row) throw new OAuthError("invalid_grant", "Unknown refresh token");
  if (row.used_at || row.revoked_at) {
    // Reuse of a rotated token means the old credential leaked. Revoke the
    // whole grant rather than continuing to serve it.
    await revokeClientGrants(row.user_id, row.client_pk);
    throw new OAuthError("invalid_grant", "Refresh token was already used; the grant has been revoked");
  }
  if (row.client_pk !== client.id) {
    throw new OAuthError("invalid_grant", "Refresh token was issued to a different client");
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new OAuthError("invalid_grant", "Refresh token has expired");
  }

  await query(
    "UPDATE agent_oauth_refresh_tokens SET used_at = now() WHERE id = $1",
    [row.id],
  );

  const scopes = parseRequestedScopes(row.scope);
  const accessToken = randomToken("hat");
  const nextRefreshToken = randomToken("hrt");

  const access = await query<{ id: string }>(
    `INSERT INTO agent_access_tokens
       (user_id, name, token_hash, token_prefix, scopes, expires_at, credential_type, resource, client_id)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval, 'oauth', $7, $8)
     RETURNING id`,
    [
      row.user_id,
      client.client_name,
      hashOpaqueToken(accessToken),
      accessToken.slice(0, 12),
      scopes,
      String(ACCESS_TOKEN_TTL_SECONDS),
      input.resource,
      client.id,
    ],
  );

  await query(
    `INSERT INTO agent_oauth_refresh_tokens
       (token_hash, user_id, client_pk, scope, access_token_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)`,
    [
      hashOpaqueToken(nextRefreshToken),
      row.user_id,
      client.id,
      formatScope(scopes),
      access.rows[0].id,
      String(REFRESH_TOKEN_TTL_SECONDS),
    ],
  );
  if (row.access_token_id) {
    await query(
      "UPDATE agent_access_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL",
      [row.access_token_id],
    );
  }

  return { accessToken, refreshToken: nextRefreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, scopes };
}

export async function revokeClientGrants(userId: string, clientPk: string): Promise<void> {
  await query(
    "UPDATE agent_oauth_grants SET revoked_at = now() WHERE user_id = $1 AND client_pk = $2",
    [userId, clientPk],
  );
  await query(
    `UPDATE agent_access_tokens
        SET revoked_at = now()
      WHERE user_id = $1 AND client_id = $2 AND revoked_at IS NULL`,
    [userId, clientPk],
  );
  await query(
    `UPDATE agent_oauth_refresh_tokens
        SET revoked_at = now()
      WHERE user_id = $1 AND client_pk = $2 AND revoked_at IS NULL`,
    [userId, clientPk],
  );
}

/** Resolves a grant to its client, but only for the user who owns it. */
export async function findOwnedGrantClient(userId: string, grantId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(grantId)) return null;
  const result = await query<{ client_pk: string }>(
    "SELECT client_pk FROM agent_oauth_grants WHERE id = $1 AND user_id = $2",
    [grantId, userId],
  );
  return result.rows[0]?.client_pk ?? null;
}

export interface OAuthGrantSummary {
  id: string;
  clientName: string;
  scope: string;
  createdAt: string;
  revokedAt: string | null;
}

export async function listUserOAuthGrants(userId: string): Promise<OAuthGrantSummary[]> {
  const result = await query<{
    id: string;
    client_name: string;
    scope: string;
    created_at: string;
    revoked_at: string | null;
  }>(
    `SELECT g.id, c.client_name, g.scope, g.created_at, g.revoked_at
       FROM agent_oauth_grants g
       JOIN agent_oauth_clients c ON c.id = g.client_pk
      WHERE g.user_id = $1
      ORDER BY g.created_at DESC`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    clientName: row.client_name,
    scope: row.scope,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }));
}

export async function revokeToken(token: unknown): Promise<void> {
  if (typeof token !== "string") return;
  if (ACCESS_TOKEN_PATTERN.test(token)) {
    await query(
      "UPDATE agent_access_tokens SET revoked_at = now() WHERE token_hash = $1",
      [hashOpaqueToken(token)],
    );
    return;
  }
  if (REFRESH_TOKEN_PATTERN.test(token)) {
    const result = await query<{ user_id: string; client_pk: string }>(
      "SELECT user_id, client_pk FROM agent_oauth_refresh_tokens WHERE token_hash = $1",
      [hashOpaqueToken(token)],
    );
    const row = result.rows[0];
    if (row) {
      await revokeClientGrants(row.user_id, row.client_pk);
    } else {
      await query(
        "UPDATE agent_oauth_refresh_tokens SET revoked_at = now() WHERE token_hash = $1",
        [hashOpaqueToken(token)],
      );
    }
  }
}
