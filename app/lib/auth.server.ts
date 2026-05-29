import { createCookieSessionStorage, redirect } from "react-router";
import { query } from "./db.server";
import { newSessionId } from "./ids";

const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-production";

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__session",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secrets: [SESSION_SECRET],
    secure: process.env.NODE_ENV === "production",
  },
});

export async function getSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

export async function getUserId(request: Request): Promise<string | null> {
  const session = await getSession(request);
  const sessionId = session.get("sessionId");
  if (!sessionId) return null;

  const result = await query<{ user_id: string; expires_at: Date }>(
    "SELECT user_id, expires_at FROM sessions WHERE id = $1",
    [sessionId]
  );
  const row = result.rows[0];
  if (!row || row.expires_at < new Date()) return null;
  return row.user_id;
}

export async function requireUserId(request: Request): Promise<string> {
  const userId = await getUserId(request);
  if (!userId) throw redirect("/");
  return userId;
}

export async function createUserSession(
  userId: string,
  redirectTo: string,
  headers: Headers = new Headers()
): Promise<Response> {
  const sessionId = newSessionId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await query(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)",
    [sessionId, userId, expiresAt]
  );

  const session = await sessionStorage.getSession();
  session.set("sessionId", sessionId);

  const cookieHeader = await sessionStorage.commitSession(session, {
    expires: expiresAt,
  });
  headers.append("Set-Cookie", cookieHeader);

  return redirect(redirectTo, { headers });
}

export async function destroyUserSession(request: Request): Promise<Response> {
  const session = await getSession(request);
  const sessionId = session.get("sessionId");
  if (sessionId) {
    await query("DELETE FROM sessions WHERE id = $1", [sessionId]);
  }
  return redirect("/", {
    headers: {
      "Set-Cookie": await sessionStorage.destroySession(session),
    },
  });
}

export async function upsertUser(email: string): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO users (email)
     VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [email]
  );
  return result.rows[0].id;
}
