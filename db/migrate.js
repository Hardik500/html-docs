import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isInternal =
  process.env.DATABASE_URL?.includes("localhost") ||
  process.env.DATABASE_URL?.includes(".internal");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isInternal ? false : { rejectUnauthorized: true },
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

const migrations = ["0001_init.sql", "0002_indexes_cleanup.sql"];
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
