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

const pool = new pg.Pool({
  connectionString: url || "postgres://localhost/html_docs_dev",
  // Supabase direct connections use a self-signed cert chain not in Node's trust
  // store — rejectUnauthorized: false keeps TLS encryption while accepting it.
  ssl: noSsl ? false : { rejectUnauthorized: false },
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

const migrations = ["0001_init.sql", "0002_indexes_cleanup.sql", "0003_supabase_auth.sql", "0004_rate_limits.sql"];
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
