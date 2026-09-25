import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
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

export const migrations = [
  "0001_init.sql",
  "0002_indexes_cleanup.sql",
  "0003_supabase_auth.sql",
  "0004_rate_limits.sql",
  "0005_markdown_support.sql",
  "0006_sync.sql",
  "0007_desktop_sessions.sql",
  "0008_desktop_auth_codes.sql",
];

export async function runMigrations(pool, logger = console) {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = await client.query("SELECT filename FROM schema_migrations");
    const appliedSet = new Set(applied.rows.map((row) => row.filename));

    for (const file of migrations) {
      if (appliedSet.has(file)) {
        logger.log(`Skipping (already applied): ${file}`);
        continue;
      }

      const sql = readFileSync(resolve(__dirname, "migrations", file), "utf8");
      logger.log(`Running migration: ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original migration error.
        }
        throw error;
      }
      logger.log(`Done: ${file}`);
    }
  } finally {
    client.release();
  }
}

async function main() {
  const pool = new pg.Pool({
    connectionString: url || "postgres://localhost/html_docs_dev",
    ssl: getPostgresSslOptions(),
  });
  try {
    await runMigrations(pool);
    console.log("All migrations complete.");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
