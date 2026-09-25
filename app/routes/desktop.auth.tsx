import { Form, useActionData, useLoaderData, Link, data } from "react-router";
import type { Route } from "./+types/desktop.auth";
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

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: "That sign-in link is incomplete. Please request a new one.",
  invalid_link: "That sign-in link is invalid or has expired. Please request a new one.",
  invalid_state: "That desktop sign-in request is invalid or has expired. Please try again.",
};

export const meta: Route.MetaFunction = () => [
  { title: "Sign in to Desktop — html-docs" },
];

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const errorCode = url.searchParams.get("error");
  const state = url.searchParams.get("state") ?? "";
  if (state && !/^[A-Za-z0-9_-]{32,200}$/.test(state)) {
    return { error: "Invalid desktop sign-in state.", state: "" };
  }
  return { error: ERROR_MESSAGES[errorCode ?? ""] ?? null, state };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const state = String(formData.get("state") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(state)) {
    return { error: "Invalid or expired desktop sign-in state." };
  }

  const parsed = z.string().email().safeParse(email);
  if (!parsed.success) return { error: "Invalid email address." };

  const ip = getClientIp(request);
  const [emailOk, ipOk] = await Promise.all([
    checkMagicEmailRate(email),
    checkMagicIpRate(ip),
  ]);
  if (!emailOk || !ipOk) {
    return { error: "Too many requests. Please try again later." };
  }

  // The response headers carry the PKCE verifier cookie back to the browser.
  const responseHeaders = new Headers();
  const { supabase } = createSupabaseServerClient(request, responseHeaders);
  const appUrl = (process.env.APP_URL || new URL(request.url).origin).replace(
    /\/+$/,
    ""
  );
  const callbackUrl = new URL(`${appUrl}/desktop/auth/callback`);
  callbackUrl.searchParams.set("state", state);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callbackUrl.toString(),
      shouldCreateUser: true,
    },
  });

  if (error) {
    console.error("[desktop/auth] signInWithOtp error:", error.message);
    return data(
      { error: "Failed to send sign-in email. Please try again." },
      { headers: responseHeaders }
    );
  }

  return data({ success: true }, { headers: responseHeaders });
}

export default function DesktopAuthPage() {
  const actionData = useActionData<typeof action>();
  const { error: urlError, state } = useLoaderData<typeof loader>();
  const actionError =
    actionData && "error" in actionData ? actionData.error : undefined;
  const errorMessage = actionError ?? urlError;
  const success = actionData && "success" in actionData && actionData.success;

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-canvas text-ink">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="block text-sm font-semibold mb-8 transition-colors text-primary"
        >
          ← html-docs
        </Link>
        <h1 className="text-2xl font-bold mb-2 text-ink">
          Sign in to html-docs Desktop
        </h1>
        <p className="text-sm mb-6 text-muted">
          Enter your email and we'll send you a magic link to connect your
          desktop app.
        </p>

        {success ? (
          <div
            className="rounded-lg p-4 text-sm border"
            style={{
              backgroundColor: "#e6f4ea",
              borderColor: "#86efac",
              color: "#166534",
            }}
          >
            Check your email! A desktop sign-in link has been sent.
          </div>
        ) : (
          <Form method="post" className="space-y-4">
            <input type="hidden" name="state" value={state} />
            {errorMessage && (
              <div
                className="rounded-lg p-3 text-sm border"
                style={{
                  backgroundColor: "#fef2f2",
                  borderColor: "#fca5a5",
                  color: "#991b1b",
                }}
              >
                {errorMessage}
              </div>
            )}
            <input
              type="email"
              name="email"
              required
              placeholder="you@example.com"
              className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 border transition-colors bg-paper border-hairline text-ink"
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
