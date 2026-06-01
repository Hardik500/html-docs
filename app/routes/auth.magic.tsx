import { Form, useActionData, Link, data } from "react-router";
import type { Route } from "./+types/auth.magic";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { checkMagicEmailRate, checkMagicIpRate } from "~/lib/ratelimit.server";
import { z } from "zod";

function getClientIp(request: Request): string {
  return (
    request.headers.get("fly-client-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown"
  );
}

export const meta: Route.MetaFunction = () => [{ title: "Sign in — html-docs" }];

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  const parsed = z.string().email().safeParse(email);
  if (!parsed.success) return { error: "Invalid email address." };

  const ip = getClientIp(request);
  const emailOk = checkMagicEmailRate(email);
  const ipOk = checkMagicIpRate(ip);
  if (!emailOk || !ipOk)
    return { error: "Too many requests. Please try again later." };

  // Must pass responseHeaders so the PKCE code verifier cookie gets set on
  // the client. Without it, Supabase rejects the callback as otp_expired.
  const responseHeaders = new Headers();
  const { supabase } = createSupabaseServerClient(request, responseHeaders);
  // Strip trailing slash to prevent double-slash in emailRedirectTo (e.g. APP_URL="https://host/" → "https://host//auth/callback")
  // Fall back to the request's own origin so the callback URL is always correct even if APP_URL is missing.
  const appUrl = (process.env.APP_URL || new URL(request.url).origin).replace(/\/+$/, "");

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${appUrl}/auth/callback`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    console.error("[auth] signInWithOtp error:", error.message);
    return data({ error: "Failed to send sign-in email. Please try again." }, { headers: responseHeaders });
  }

  return data({ success: true }, { headers: responseHeaders });
}

export default function MagicLinkPage() {
  const actionData = useActionData<typeof action>();
  // Also surface errors forwarded from /auth/callback via query string
  const urlError =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("error")
      : null;
  const errorMessage = ('error' in (actionData ?? {}) ? (actionData as { error: string }).error : null) ?? urlError;

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-canvas text-ink">
      <div className="w-full max-w-md">
        <Link to="/" className="block text-sm font-semibold mb-8 transition-colors text-primary">
          ← html-docs
        </Link>
        <h1 className="text-2xl font-bold mb-2 text-ink">Sign in</h1>
        <p className="text-sm mb-6 text-muted">
          Enter your email and we'll send you a magic link to sign in.
        </p>

        {'success' in (actionData ?? {}) ? (
          <div className="rounded-lg p-4 text-sm border" style={{ backgroundColor: "#e6f4ea", borderColor: "#86efac", color: "#166534" }}>
            Check your email! A sign-in link has been sent.
          </div>
        ) : (
          <Form method="post" className="space-y-4">
            {errorMessage && (
              <div className="rounded-lg p-3 text-sm border" style={{ backgroundColor: "#fef2f2", borderColor: "#fca5a5", color: "#991b1b" }}>
                {errorMessage}
              </div>
            )}
            <input
              type="email"
              name="email"
              required
              placeholder="you@example.com"
              className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 border transition-colors bg-white border-hairline text-ink"
            />
            <button
              type="submit"
              className="w-full text-white font-medium py-2.5 rounded-lg transition-colors bg-primary hover:bg-primary-dark"
            >
              Send magic link
            </button>
          </Form>
        )}
      </div>
    </main>
  );
}
