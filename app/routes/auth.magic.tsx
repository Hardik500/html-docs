import { Form, useActionData, Link } from "react-router";
import type { Route } from "./+types/auth.magic";
import { query } from "~/lib/db.server";
import { newMagicToken } from "~/lib/ids";
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

  if (!emailOk || !ipOk) {
    return { error: "Too many requests. Please try again later." };
  }

  const token = newMagicToken();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

  await query(
    "INSERT INTO magic_tokens (token, email, expires_at) VALUES ($1, $2, $3)",
    [token, email, expiresAt]
  );

  const appUrl = process.env.APP_URL || "http://localhost:5173";
  const magicLink = `${appUrl}/auth/magic/${token}`;

  // In dev without a Resend key, log the link to the terminal so you can
  // test the auth flow without setting up an email provider.
  if (!process.env.RESEND_API_KEY || process.env.NODE_ENV !== "production") {
    console.log("\n🔗 [DEV] Magic link (no email sent):");
    console.log(`   ${magicLink}\n`);
    return { success: true };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.EMAIL_FROM || "noreply@html-docs.app",
      to: email,
      subject: "Sign in to html-docs",
      html: `
        <p>Click the link below to sign in to html-docs. This link expires in 15 minutes.</p>
        <p><a href="${magicLink}">${magicLink}</a></p>
        <p>If you didn't request this, you can ignore this email.</p>
      `,
    });
  } catch (err) {
    console.error("Failed to send magic link:", err);
    return { error: "Failed to send email. Please try again." };
  }

  return { success: true };
}

export default function MagicLinkPage() {
  const data = useActionData<typeof action>();

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

        {data?.success ? (
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-4 text-green-300 text-sm">
            Check your email! A sign-in link has been sent.
          </div>
        ) : (
          <Form method="post" className="space-y-4">
            {data?.error && (
              <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
                {data.error}
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
