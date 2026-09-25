import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrations } from "../db/migrate.js";

describe("hosted migration registry", () => {
  it("registers every SQL migration file", () => {
    const migrationDirectory = path.resolve("db/migrations");
    const files = readdirSync(migrationDirectory)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect([...migrations].sort()).toEqual(files);
  });
});
