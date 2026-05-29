import type { Route } from "./+types/auth.magic.$token";
import { query } from "~/lib/db.server";
import { upsertUser, createUserSession } from "~/lib/auth.server";

export async function loader({ params, request }: Route.LoaderArgs) {
  const { token } = params;

  const result = await query<{
    email: string;
    expires_at: Date;
    used_at: Date | null;
  }>(
    "SELECT email, expires_at, used_at FROM magic_tokens WHERE token = $1",
    [token]
  );

  if (!result.rows.length) {
    throw new Response("Invalid or expired link.", { status: 400 });
  }

  const row = result.rows[0];

  if (row.used_at || new Date(row.expires_at) < new Date()) {
    throw new Response("This link has already been used or has expired.", {
      status: 400,
    });
  }

  // Mark token as used
  await query("UPDATE magic_tokens SET used_at = now() WHERE token = $1", [
    token,
  ]);

  const userId = await upsertUser(row.email);

  const redirectTo =
    new URL(request.url).searchParams.get("redirect") || "/dashboard";

  return createUserSession(userId, redirectTo);
}

export default function MagicTokenPage() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center">
      <p className="text-gray-400">Signing you in…</p>
    </main>
  );
}
