import { randomBytes } from "node:crypto";
import { redirect } from "react-router";
import type { Route } from "./+types/desktop.auth.callback";
import { query } from "~/lib/db.server";
import { hashDesktopToken } from "~/lib/auth.server";
import { createSupabaseServerClient } from "~/lib/supabase.server";

const DESKTOP_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
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

  const token = `dhd_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + DESKTOP_SESSION_TTL_MS);
  await query(
    `INSERT INTO desktop_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, hashDesktopToken(token), expiresAt.toISOString()],
  );

  return redirect(
    `html-docs://auth/callback?token=${encodeURIComponent(token)}`,
    { headers: responseHeaders }
  );
}

export default function DesktopAuthCallback() {
  return (
    <main className="min-h-screen bg-canvas text-ink flex items-center justify-center">
      <p className="text-muted">Connecting the desktop app…</p>
    </main>
  );
}
