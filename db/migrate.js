import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL ?? "";
const noSsl =
  !url ||
  url.includes("localhost") ||
  url.includes("127.0.0.1") ||
  url.includes(".internal");

function getPostgresSslOptions() {
  if (noSsl) return false;
  const ssl = { rejectUnauthorized: true };
  const caPath = process.env.DATABASE_CA_CERT_PATH;
  if (caPath) ssl.ca = readFileSync(caPath, "utf8");
  return ssl;
}

const pool = new pg.Pool({
  connectionString: url || "postgres://localhost/html_docs_dev",
  ssl: getPostgresSslOptions(),
});

// Ensure the tracking table exists
await pool.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);

// Load already-applied migrations
const applied = await pool.query("SELECT filename FROM schema_migrations");
const appliedSet = new Set(applied.rows.map((r) => r.filename));

const migrations = [
  "0001_init.sql",
  "0002_indexes_cleanup.sql",
  "0003_supabase_auth.sql",
  "0004_rate_limits.sql",
  "0005_markdown_support.sql",
  "0006_sync.sql",
  "0007_desktop_sessions.sql",
  "0008_desktop_auth_codes.sql",
];
for (const file of migrations) {
  if (appliedSet.has(file)) {
    console.log(`Skipping (already applied): ${file}`);
    continue;
  }
  const sql = readFileSync(resolve(__dirname, "migrations", file), "utf8");
  console.log(`Running migration: ${file}`);
  await pool.query(sql);
  await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
  console.log(`Done: ${file}`);
}
await pool.end();
console.log("All migrations complete.");
