import { randomBytes } from "node:crypto";
import type { Route } from "./+types/desktop.auth.exchange";
import { withTransaction } from "~/lib/db.server";
import { hashDesktopAuthCode, hashDesktopToken } from "~/lib/auth.server";

const DESKTOP_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function readBody(request: Request): Promise<{ code: string; state: string }> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) throw new Response("Payload too large", { status: 413 });
  const body = request.body;
  if (!body) throw new Response("JSON body is required", { status: 400 });
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value?.byteLength ?? 0;
    if (total > 16_384) {
      await reader.cancel();
      throw new Response("Payload too large", { status: 413 });
    }
    if (value) chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      code?: unknown;
      state?: unknown;
    };
    const code = typeof parsed.code === "string" ? parsed.code : "";
    const state = typeof parsed.state === "string" ? parsed.state : "";
    if (!/^dac_[A-Za-z0-9_-]{43}$/.test(code)) {
      throw new Response("Invalid authorization code", { status: 400 });
    }
    if (!/^[A-Za-z0-9_-]{32,200}$/.test(state)) {
      throw new Response("Invalid authorization state", { status: 400 });
    }
    return { code, state };
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response("Invalid JSON body", { status: 400 });
  }
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }
  const { code, state } = await readBody(request);
  const token = `dhd_${randomBytes(32).toString("base64url")}`;

  const result = await withTransaction(async (runQuery) => {
    const authCode = await runQuery<{ user_id: string }>(
      `SELECT user_id
         FROM desktop_auth_codes
        WHERE code_hash = $1
          AND state = $2
          AND used_at IS NULL
          AND expires_at > now()
        FOR UPDATE`,
      [hashDesktopAuthCode(code), state],
    );
    if (!authCode.rows.length) return { ok: false as const };

    await runQuery(
      `UPDATE desktop_auth_codes
          SET used_at = now()
        WHERE code_hash = $1`,
      [hashDesktopAuthCode(code)],
    );
    await runQuery(
      `INSERT INTO desktop_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [
        authCode.rows[0].user_id,
        hashDesktopToken(token),
        new Date(Date.now() + DESKTOP_SESSION_TTL_MS).toISOString(),
      ],
    );
    return { ok: true as const };
  });

  if (!result.ok) {
    throw new Response("Authorization code is invalid, expired, or already used", {
      status: 400,
    });
  }

  return Response.json(
    { token },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export function loader() {
  return new Response("Method not allowed", { status: 405 });
}
