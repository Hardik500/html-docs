import { redirect } from "react-router";
import type { Route } from "./+types/auth.callback";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { withTransaction } from "~/lib/db.server";
import { claimDocument } from "~/lib/claim.server";

function readCookie(header: string, name: string): string | null {
  const value = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return value ? decodeURIComponent(value) : null;
}


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
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  const user = data?.user;

  if (error || !user) {
    console.error(
      "[auth/callback] exchange error:",
      error?.message ?? "No authenticated user",
    );
    return redirect("/auth/magic?error=invalid_link", {
      headers: responseHeaders,
    });
  }

  const claimDocId = url.searchParams.get("claimDocId") ?? "";
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(claimDocId)) {
    const claimCookieName = `html_docs_claim_${claimDocId}`;
    const claimToken = readCookie(
      request.headers.get("cookie") ?? "",
      claimCookieName,
    );
    if (claimToken && /^[a-zA-Z0-9_-]{24,128}$/.test(claimToken)) {
      const result = await withTransaction((runQuery) =>
        claimDocument(runQuery, claimDocId, claimToken, user.id),
      );
      const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
      responseHeaders.append(
        "Set-Cookie",
        `${claimCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
      );
      if (result.kind === "claimed") {
        return redirect(`/d/${claimDocId}/edit`, { headers: responseHeaders });
      }
    }
  }

  const rawRedirect = url.searchParams.get("redirect") ?? "";
  // Reject protocol-relative and backslash forms, which browsers resolve as
  // "//host" and would turn into an open redirect.
  const redirectTo = /^\/(?!\/)[^\r\n\\]*$/.test(rawRedirect) ? rawRedirect : "/dashboard";

  return redirect(redirectTo, { headers: responseHeaders });
}

export default function AuthCallback() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
      <p className="text-gray-400">Signing you in…</p>
    </main>
  );
}
