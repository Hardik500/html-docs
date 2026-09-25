import type { Route } from "./+types/well-known.oauth-authorization-server";
import { authorizationServerMetadata } from "~/lib/oauth.server";

export function loader({ request }: Route.LoaderArgs) {
  return Response.json(authorizationServerMetadata(request), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
