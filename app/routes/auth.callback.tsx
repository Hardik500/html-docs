import { redirect } from "react-router";
import type { Route } from "./+types/auth.callback";
import { createSupabaseServerClient } from "~/lib/supabase.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  const responseHeaders = new Headers();

  // Supabase forwards its own error params here when the link is invalid/expired.
  const supabaseError = url.searchParams.get("error");
  if (supabaseError) {
    const desc = url.searchParams.get("error_description") ?? supabaseError;
    console.error("[auth/callback] Supabase error:", desc);
    const msg = encodeURIComponent(desc.replace(/\+/g, " "));
    return redirect(`/auth/magic?error=${msg}`, { headers: responseHeaders });
  }

  if (!code) {
    return redirect("/auth/magic?error=missing_code", {
      headers: responseHeaders,
    });
  }

  const { supabase } = createSupabaseServerClient(request, responseHeaders);
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback] exchange error:", error.message);
    return redirect("/auth/magic?error=invalid_link", {
      headers: responseHeaders,
    });
  }

  const rawRedirect = url.searchParams.get("redirect") ?? "";
  const redirectTo =
    rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : "/dashboard";

  return redirect(redirectTo, { headers: responseHeaders });
}

export default function AuthCallback() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
      <p className="text-gray-400">Signing you in…</p>
    </main>
  );
}
