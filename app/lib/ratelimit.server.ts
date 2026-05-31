import { createHash } from "crypto";

const IP_HASH_SALT = process.env.IP_HASH_SALT || "default-salt-change-me";

// In-memory store: key → { count, resetAt }
// Resets on process restart/deploy. Acceptable for soft rate limiting.
const store = new Map<string, { count: number; resetAt: number }>();

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

function checkAndIncrement(key: string, limit: number, resetAt: number): boolean {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

/** 50 anon doc creates per IP per day */
export function checkAnonCreateRate(ip: string): boolean {
  const key = `anon:ip:${hashIp(ip)}:${todayUtc()}`;
  const resetAt = new Date();
  resetAt.setUTCHours(24, 0, 0, 0);
  return checkAndIncrement(key, 50, resetAt.getTime());
}

/** 5 magic-link requests per email per minute */
export function checkMagicEmailRate(email: string): boolean {
  const key = `magic:email:${email}:${currentMinuteUtc()}`;
  return checkAndIncrement(key, 5, Date.now() + 60_000);
}

/** 20 magic-link requests per IP per day */
export function checkMagicIpRate(ip: string): boolean {
  const key = `magic:ip:${hashIp(ip)}:${todayUtc()}`;
  const resetAt = new Date();
  resetAt.setUTCHours(24, 0, 0, 0);
  return checkAndIncrement(key, 20, resetAt.getTime());
}
