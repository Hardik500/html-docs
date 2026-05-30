export function validateEnv(): void {
  const required = [
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "APP_URL",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length)
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);

  if (!process.env.IP_HASH_SALT || process.env.IP_HASH_SALT === "default-salt-change-me")
    console.warn(
      "[env] IP_HASH_SALT is weak or unset — rate-limit IPs will be hashed with a predictable salt."
    );
}
