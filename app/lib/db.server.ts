import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool;

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: pg.Pool | undefined;
}

// Reuse pool across hot-reloads in development
if (process.env.NODE_ENV === "production") {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
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
