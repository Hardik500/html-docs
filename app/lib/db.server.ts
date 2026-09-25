import { readFileSync } from "node:fs";
import pg from "pg";
import { isDesktopRuntime } from "./runtime.server";
import { validateEnv } from "./env.server";
import { LOCAL_MIGRATIONS, LOCAL_SCHEMA_VERSION } from "./local-schema.server";

const { Pool } = pg;

type QueryResult<T> = { rows: T[] };
type LocalDatabase = import("@electric-sql/pglite").PGlite;

let pgPool: pg.Pool | undefined;
let localDatabase: LocalDatabase | undefined;
let localDatabaseReady: Promise<LocalDatabase> | undefined;

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: pg.Pool | undefined;
}

export function getPostgresSslOptions(url: string) {
  const noSsl =
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes(".internal");
  if (noSsl) return false;

  const ssl: { rejectUnauthorized: true; ca?: string } = {
    rejectUnauthorized: true,
  };
  const caPath = process.env.DATABASE_CA_CERT_PATH;
  if (caPath) ssl.ca = readFileSync(caPath, "utf8");
  return ssl;
}

function getPostgresPool(): pg.Pool {
  if (process.env.NODE_ENV === "production") {
    validateEnv();
  }

  if (process.env.NODE_ENV !== "production") {
    if (!global.__pgPool) {
      global.__pgPool = new Pool({
        connectionString:
          process.env.DATABASE_URL || "postgres://localhost/html_docs_dev",
      });
    }
    return global.__pgPool;
  }

  if (!pgPool) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Keep TCP connections warm so queries do not pay a fresh TLS handshake
      // to a remote Supabase host on every cold connection.
      keepAlive: true,
      ssl: getPostgresSslOptions(process.env.DATABASE_URL ?? ""),
    });
  }

  return pgPool;
}

async function getLocalDatabase(): Promise<LocalDatabase> {
  if (localDatabase) return localDatabase;

  if (!localDatabaseReady) {
    localDatabaseReady = (async () => {
      const dataDir = process.env.HTML_DOCS_DATA_DIR;
      if (!dataDir) {
        throw new Error(
          "HTML_DOCS_DATA_DIR is required when HTML_DOCS_RUNTIME=desktop",
        );
      }

      const { PGlite } = await import("@electric-sql/pglite");
      const database = await PGlite.create(dataDir);
      await database.exec(`
        CREATE TABLE IF NOT EXISTS local_schema_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          version INTEGER NOT NULL
        )
      `);
      const versionResult = await database.query<{ version: number }>(
        "SELECT version FROM local_schema_meta WHERE id = 1",
      );
      const currentVersion = Number(versionResult.rows[0]?.version ?? 0);
      if (currentVersion > LOCAL_SCHEMA_VERSION) {
        throw new Error(
          `Local database schema ${currentVersion} is newer than supported schema ${LOCAL_SCHEMA_VERSION}`,
        );
      }
      for (const migration of LOCAL_MIGRATIONS) {
        if (migration.version <= currentVersion) continue;
        await database.exec(migration.sql);
        await database.query(
          `INSERT INTO local_schema_meta (id, version)
           VALUES (1, $1)
           ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version`,
          [migration.version],
        );
      }
      localDatabase = database;
      return database;
    })();
  }

  return localDatabaseReady;
}

export type QueryRunner = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  if (isDesktopRuntime()) {
    const database = await getLocalDatabase();
    return (await database.query<T>(text, params)) as unknown as QueryResult<T>;
  }

  return getPostgresPool().query<T>(text, params) as Promise<QueryResult<T>>;
}

export async function withTransaction<T>(
  callback: (runQuery: QueryRunner) => Promise<T>,
): Promise<T> {
  if (isDesktopRuntime()) {
    const database = await getLocalDatabase();
    return database.transaction(async (transaction) => {
      const runQuery: QueryRunner = async <TRow extends pg.QueryResultRow>(
        text: string,
        params?: unknown[],
      ) =>
        (await transaction.query<TRow>(text, params)) as unknown as QueryResult<TRow>;
      return callback(runQuery);
    });
  }

  const client = await getPostgresPool().connect();
  const runQuery: QueryRunner = async <TRow extends pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ) => (await client.query<TRow>(text, params)) as unknown as QueryResult<TRow>;

  try {
    await client.query("BEGIN");
    const result = await callback(runQuery);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabase(): Promise<void> {
  if (localDatabase) {
    await localDatabase.close();
    localDatabase = undefined;
    localDatabaseReady = undefined;
  }

  if (pgPool) {
    await pgPool.end();
    pgPool = undefined;
  }
}
