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
    <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="block text-sm font-semibold text-indigo-400 mb-8 hover:text-indigo-300 transition-colors">
          ← html-docs
        </Link>
        <h1 className="text-2xl font-bold mb-2">Sign in</h1>
        <p className="text-gray-400 text-sm mb-6">
          Enter your email and we'll send you a magic link to sign in.
        </p>

        {'success' in (actionData ?? {}) ? (
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-4 text-green-300 text-sm">
            Check your email! A sign-in link has been sent.
          </div>
        ) : (
          <Form method="post" className="space-y-4">
            {errorMessage && (
              <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
                {errorMessage}
              </div>
            )}
            <input
              type="email"
              name="email"
              required
              placeholder="you@example.com"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg transition-colors"
            >
              Send magic link
            </button>
          </Form>
        )}
      </div>
    </main>
  );
}
