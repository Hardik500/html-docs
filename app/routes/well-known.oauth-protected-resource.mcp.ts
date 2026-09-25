import type { Route } from "./+types/well-known.oauth-protected-resource.mcp";
import { protectedResourceMetadata } from "~/lib/oauth.server";

/**
 * Path-aware metadata URL for the `/mcp` resource. Clients that follow the
 * RFC 9728 path convention request this exact path; the shorter
 * `/.well-known/oauth-protected-resource` document stays valid too.
 */
export function loader({ request }: Route.LoaderArgs) {
  return Response.json(protectedResourceMetadata(request), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
