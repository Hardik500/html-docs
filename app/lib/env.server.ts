export function validateEnv(): void {
  // Hard requirements — app is non-functional without these
  const required = ["DATABASE_URL", "SESSION_SECRET", "APP_URL"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(", ")}`);

  if (process.env.SESSION_SECRET === "change-me-in-production")
    throw new Error("SESSION_SECRET must be changed from the default.");

  // Soft requirements — app starts but features degrade gracefully
  if (!process.env.RESEND_API_KEY)
    console.warn("[env] RESEND_API_KEY is not set — magic-link emails will not be sent.");

  if (!process.env.IP_HASH_SALT || process.env.IP_HASH_SALT === "default-salt-change-me")
    console.warn("[env] IP_HASH_SALT is weak or unset — rate-limit IPs will be hashed with a predictable salt.");
}
