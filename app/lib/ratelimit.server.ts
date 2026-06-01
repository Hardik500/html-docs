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
  return new Date().toISOString().slice(0, 16);
}

/**
 * Atomically increment a rate-limit counter in Postgres and return whether
 * the request is within the allowed limit.
 *
 * Uses an upsert so expired rows are reset in-place rather than deleted first.
 * Safe under concurrent requests — Postgres serialises the ON CONFLICT update.
 */
async function checkAndIncrement(key: string, limit: number, resetAt: Date): Promise<boolean> {
  const result = await query<{ count: number }>(
    `INSERT INTO rate_limits (key, count, reset_at)
     VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE
       SET count    = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
           reset_at = CASE WHEN rate_limits.reset_at <= now() THEN $2 ELSE rate_limits.reset_at END
     RETURNING count`,
    [key, resetAt.toISOString()]
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
  return checkAndIncrement(key, 5, new Date(Date.now() + 60_000));
}

/** 20 magic-link requests per IP per day */
export async function checkMagicIpRate(ip: string): Promise<boolean> {
  const key = `magic:ip:${hashIp(ip)}:${todayUtc()}`;
  const resetAt = new Date();
  resetAt.setUTCHours(24, 0, 0, 0);
  return checkAndIncrement(key, 20, resetAt);
}

/** 30 saves per doc per minute — prevents write-flood abuse of the auto-save endpoint */
export async function checkSaveRate(docId: string): Promise<boolean> {
  const key = `save:doc:${docId}:${currentMinuteUtc()}`;
  return checkAndIncrement(key, 30, new Date(Date.now() + 60_000));
}
