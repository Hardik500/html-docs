import type { Route } from "./+types/desktop.auth.revoke";
import { query } from "~/lib/db.server";
import { hashDesktopToken } from "~/lib/auth.server";

export async function action({ request }: Route.ActionArgs) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!token.startsWith("dhd_")) {
    throw new Response("Desktop session token is required", { status: 401 });
  }

  await query(
    `UPDATE desktop_sessions
        SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashDesktopToken(token)],
  );
  return new Response(null, { status: 204 });
}

export function loader() {
  return new Response("Method not allowed", { status: 405 });
}
