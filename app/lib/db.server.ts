import pg from "pg";
import { validateEnv } from "./env.server";

const { Pool } = pg;

let pool: pg.Pool;

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: pg.Pool | undefined;
}

// Reuse pool across hot-reloads in development
if (process.env.NODE_ENV === "production") {
  validateEnv();
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Keep TCP connections warm so queries don't pay a fresh TLS handshake to
    // a remote Supabase host on every cold connection.
    keepAlive: true,
    ssl: (() => {
      const u = process.env.DATABASE_URL ?? "";
      const noSsl = u.includes("localhost") || u.includes("127.0.0.1") || u.includes(".internal");
      if (noSsl) return false;
      // Supabase direct connections use a self-signed certificate chain not in
      // Node's default trust store, so we can't use rejectUnauthorized: true here.
      // The connection is still TLS-encrypted; cert verification requires downloading
      // the Supabase CA cert (Dashboard → Database → Settings → SSL Certificate)
      // and passing it via { ca: fs.readFileSync('supabase-ca.crt') }.
      return { rejectUnauthorized: false };
    })(),
  });
} else {
  if (!global.__pgPool) {
    global.__pgPool = new Pool({
      connectionString:
        process.env.DATABASE_URL || "postgres://localhost/html_docs_dev",
    });
  }
  pool = global.__pgPool;
}

export { pool };

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}
