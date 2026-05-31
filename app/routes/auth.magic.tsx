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
  const [emailOk, ipOk] = await Promise.all([
    checkMagicEmailRate(email),
    checkMagicIpRate(ip),
  ]);
  if (!emailOk || !ipOk)
    return { error: "Too many requests. Please try again later." };

  // Must pass responseHeaders so the PKCE code verifier cookie gets set on
  // the client. Without it, Supabase rejects the callback as otp_expired.
  const responseHeaders = new Headers();
  const { supabase } = createSupabaseServerClient(request, responseHeaders);
  const appUrl = process.env.APP_URL || "http://localhost:5173";

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
    <main className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#faf9f5", color: "#141413" }}>
      <div className="w-full max-w-md">
        <Link to="/" className="block text-sm font-semibold mb-8 transition-colors" style={{ color: "#cc785c" }}>
          ← html-docs
        </Link>
        <h1 className="text-2xl font-bold mb-2" style={{ color: "#141413" }}>Sign in</h1>
        <p className="text-sm mb-6" style={{ color: "#6c6a64" }}>
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
              className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 border transition-colors"
              style={{ backgroundColor: "white", borderColor: "#e6dfd8", color: "#141413" }}
            />
            <button
              type="submit"
              className="w-full text-white font-medium py-2.5 rounded-lg transition-colors"
              style={{ backgroundColor: "#cc785c" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#a9583e")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#cc785c")}
            >
              Send magic link
            </button>
          </Form>
        )}
      </div>
    </main>
  );
}
