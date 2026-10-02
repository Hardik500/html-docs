/**
 * The MCP resource identifier, in one place.
 *
 * A token minted over OAuth is bound to a resource string, and `mcp.ts` rejects
 * a credential whose resource does not match the endpoint it was presented to
 * (`isWrongAudience`). Both sides have to agree, or a correctly-minted token is
 * refused. That made this worth extracting rather than duplicating:
 *
 * - The OAuth flow binds tokens with `resourceIdentifier`.
 * - The endpoint validates them against the same value.
 * - `/.well-known/opencode` advertises the same value as the server URL, so a
 *   client that discovers the server here connects to the one the token is for.
 *
 * Resolution order is `MCP_RESOURCE_URL`, then `APP_URL` + `/mcp`, then the
 * request origin. Both env vars are optional and documented separately in the
 * README, so deriving this differently in two places was a real way to lock
 * every OAuth grant out of a non-canonical host.
 */

/** The canonical origin for this deployment, without a trailing slash. */
export function mcpResourceOrigin(request: Request): string {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

/** The resource identifier tokens are bound to, and clients are pointed at. */
export function resourceIdentifier(request: Request): string {
  const configured = process.env.MCP_RESOURCE_URL;
  if (configured) return configured;
  return `${mcpResourceOrigin(request)}/mcp`;
}

/** `resourceIdentifier` as a URL, for building the discovery document's hints. */
export function mcpResourceUrl(request: Request): URL {
  return new URL(resourceIdentifier(request));
}