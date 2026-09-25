import type { Route } from "./+types/well-known.oauth-protected-resource";
import { protectedResourceMetadata } from "~/lib/oauth.server";

export function loader({ request }: Route.LoaderArgs) {
  return Response.json(protectedResourceMetadata(request), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
