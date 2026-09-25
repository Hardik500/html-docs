import { createHash } from "node:crypto";
import { redirect } from "react-router";
import { query } from "./db.server";
import { createSupabaseServerClient } from "./supabase.server";
import { isDesktopRuntime, LOCAL_USER_ID } from "./runtime.server";

export function hashDesktopToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getUser(
  request: Request
): Promise<{ id: string; email: string } | null> {
  if (isDesktopRuntime()) {
    return { id: LOCAL_USER_ID, email: "local@html-docs" };
  }

  const { supabase } = createSupabaseServerClient(request);
  const authorization = request.headers.get("authorization");
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;

  // Desktop sync uses a bearer token because its local loopback origin cannot
  // share the hosted app's HttpOnly cookie. Cookie-based web requests keep the
  // existing locally-verified claims path.
  if (bearerToken?.startsWith("dhd_")) {
    const result = await query<{ user_id: string; email: string | null }>(
      `UPDATE desktop_sessions AS session
          SET last_used_at = now()
         FROM auth.users AS app_user
        WHERE session.token_hash = $1
          AND session.expires_at > now()
          AND session.revoked_at IS NULL
          AND app_user.id = session.user_id
     RETURNING session.user_id, app_user.email`,
      [hashDesktopToken(bearerToken)],
    );
    const desktopUser = result.rows[0];
    if (!desktopUser) return null;
    return {
      id: desktopUser.user_id,
      email: desktopUser.email ?? "",
    };
  }

  if (bearerToken) {
    const { data, error } = await supabase.auth.getUser(bearerToken);
    if (error || !data.user) return null;
    return {
      id: data.user.id,
      email: typeof data.user.email === "string" ? data.user.email : "",
    };
  }

  // Verify the JWT locally via cached JWKS (asymmetric signing keys) instead of
  // a network round trip to the Auth server. Session refresh/persistence is
  // handled once per request by the root loader.
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) return null;
  const email = data.claims.email;
  return { id: sub, email: typeof email === "string" ? email : "" };
}

export async function getUserId(request: Request): Promise<string | null> {
  const user = await getUser(request);
  return user?.id ?? null;
}

export async function requireUserId(request: Request): Promise<string> {
  const userId = await getUserId(request);
  if (!userId) throw redirect("/");
  return userId;
}
