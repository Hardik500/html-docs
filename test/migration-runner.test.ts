import { describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrate.js";

describe("hosted migration runner", () => {
  it("rolls back a failed migration before releasing the client", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("CREATE TABLE IF NOT EXISTS docs")) {
        throw new Error("migration failed");
      }
      if (sql.startsWith("SELECT filename")) return { rows: [] };
      return { rows: [] };
    });
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({ query, release })),
    };

    await expect(runMigrations(pool, { log: vi.fn() })).rejects.toThrow(
      "migration failed",
    );
    expect(query).toHaveBeenCalledWith("BEGIN");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(query).not.toHaveBeenCalledWith(
      "INSERT INTO schema_migrations (filename) VALUES ($1)",
      expect.anything(),
    );
    expect(release).toHaveBeenCalledOnce();
  });
});
