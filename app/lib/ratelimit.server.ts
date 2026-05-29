import { createHash } from "crypto";
import { query } from "./db.server";

const IP_HASH_SALT = process.env.IP_HASH_SALT || "default-salt-change-me";

function hashIp(ip: string): string {
  return createHash("sha256")
    .update(ip + IP_HASH_SALT)
    .digest("hex")
    .slice(0, 16);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentMinuteUtc(): string {
  const d = new Date();
  return `${d.toISOString().slice(0, 16)}`;
}

async function checkAndIncrement(
  key: string,
  limit: number,
  resetAt: Date
): Promise<boolean> {
  const result = await query<{ count: number; reset_at: Date }>(
    `INSERT INTO rate_limits (key, count, reset_at)
     VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE
       SET count    = CASE WHEN rate_limits.reset_at < now() THEN 1 ELSE rate_limits.count + 1 END,
           reset_at = CASE WHEN rate_limits.reset_at < now() THEN $2 ELSE rate_limits.reset_at END
     RETURNING count, reset_at`,
    [key, resetAt]
  );
  return result.rows[0].count <= limit;
}

/** 50 anon doc creates per IP per day */
export async function checkAnonCreateRate(ip: string): Promise<boolean> {
  const key = `anon:ip:${hashIp(ip)}:${todayUtc()}`;
  const resetAt = new Date();
  resetAt.setUTCHours(24, 0, 0, 0);
  return checkAndIncrement(key, 50, resetAt);
}

/** 5 magic-link requests per email per minute */
export async function checkMagicEmailRate(email: string): Promise<boolean> {
  const key = `magic:email:${email}:${currentMinuteUtc()}`;
  const resetAt = new Date(Date.now() + 60_000);
  return checkAndIncrement(key, 5, resetAt);
}

/** 20 magic-link requests per IP per day */
export async function checkMagicIpRate(ip: string): Promise<boolean> {
  const key = `magic:ip:${hashIp(ip)}:${todayUtc()}`;
  const resetAt = new Date();
  resetAt.setUTCHours(24, 0, 0, 0);
  return checkAndIncrement(key, 20, resetAt);
}
