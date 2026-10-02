import type { Route } from "./+types/well-known.opencode";
import { isDesktopRuntime } from "~/lib/runtime.server";
import { mcpResourceUrl } from "~/lib/mcp-resource.server";

/**
 * opencode's remote configuration endpoint.
 *
 * opencode fetches `<origin>/.well-known/opencode` and merges the result as the
 * lowest-precedence config layer, beneath the user's global and project config
 * but above nothing. The document is ordinary opencode config — an `mcp` object
 * with the same schema as `opencode.json` — not an envelope, so there is no
 * version field to negotiate.
 *
 * `enabled: false` is deliberate and is what the opencode docs prescribe for an
 * organization offering its own servers: the entry appears for the user to opt
 * into, rather than connecting every visitor to a server they have no token for.
 * No `headers` key is sent either, so an opted-in client hits the endpoint's
 * 401, and opencode then runs the OAuth 2.1 flow this app already implements
 * (dynamic registration + PKCE) instead of needing a pasted agent token.
 *
 * The advertised URL comes from the shared resource helper rather than the
 * request origin, so it is the same value an OAuth grant is bound to. If the two
 * ever disagreed, a discovered client would connect and be refused as a wrong
 * audience.
 */
export function loader({ request }: Route.LoaderArgs) {
  // Desktop runs the same app against a local PGlite database with no hosted
  // origin, so there is no MCP endpoint to point a remote client at.
  if (isDesktopRuntime()) {
    throw new Response("Not found", { status: 404 });
  }

  return Response.json(
    {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        "html-docs": {
          type: "remote",
          url: mcpResourceUrl(request).toString(),
          enabled: false,
        },
      },
    },
    {
      headers: {
        // Public and identical for every visitor; it holds no per-user state.
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}