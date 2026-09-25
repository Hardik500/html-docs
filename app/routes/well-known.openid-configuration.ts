import type { Route } from "./+types/well-known.openid-configuration";
import { authorizationServerMetadata } from "~/lib/oauth.server";

/** Alias some MCP clients probe instead of the RFC 8414 path. */
export function loader({ request }: Route.LoaderArgs) {
  return Response.json(authorizationServerMetadata(request), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
