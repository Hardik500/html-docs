import { randomBytes } from "node:crypto";
import { redirect } from "react-router";
import type { Route } from "./+types/desktop.auth.callback";
import { query } from "~/lib/db.server";
import { hashDesktopAuthCode } from "~/lib/auth.server";
import { createSupabaseServerClient } from "~/lib/supabase.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const responseHeaders = new Headers({ "Cache-Control": "no-store" });

  const supabaseError = url.searchParams.get("error");
  if (supabaseError) {
    const description =
      url.searchParams.get("error_description") ?? supabaseError;
    console.error("[desktop/auth/callback] Supabase error:", description);
    return redirect("/desktop/auth?error=invalid_link", {
      headers: responseHeaders,
    });
  }

  if (!code) {
    return redirect("/desktop/auth?error=missing_code", {
      headers: responseHeaders,
    });
  }

  if (!/^[A-Za-z0-9_-]{32,200}$/.test(state)) {
    return redirect("/desktop/auth?error=invalid_state", {
      headers: responseHeaders,
    });
  }

  const { supabase } = createSupabaseServerClient(request, responseHeaders);
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  const user = data?.user;

  if (error || !user) {
    console.error(
      "[desktop/auth/callback] exchange error:",
      error?.message ?? "No authenticated user",
    );
    return redirect("/desktop/auth?error=invalid_link", {
      headers: responseHeaders,
    });
  }

  const authorizationCode = `dac_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  await query(
    `INSERT INTO desktop_auth_codes (code_hash, state, user_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [hashDesktopAuthCode(authorizationCode), state, user.id, expiresAt.toISOString()],
  );

  return redirect(
    `html-docs://auth/callback?code=${encodeURIComponent(authorizationCode)}&state=${encodeURIComponent(state)}`,
    { headers: responseHeaders },
  );
}

export default function DesktopAuthCallback() {
  return (
    <main className="min-h-screen bg-canvas text-ink flex items-center justify-center">
      <p className="text-muted">Connecting the desktop app…</p>
    </main>
  );
}
