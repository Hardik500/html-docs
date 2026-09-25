import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { getWorkspaceDataDir } = require("../electron/workspace.cjs") as {
  getWorkspaceDataDir: (userDataPath: string, accountId?: string) => Promise<string>;
};

const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "22222222-2222-4222-8222-222222222222";
const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempPaths.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function userDataDir(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "html-docs-workspace-"));
  tempPaths.push(directory);
  return directory;
}

describe("desktop workspace selection", () => {
  it("binds the legacy workspace to the first account and isolates later accounts", async () => {
    const userDataPath = await userDataDir();
    await mkdir(path.join(userDataPath, "data", "pglite"), { recursive: true });

    expect(await getWorkspaceDataDir(userDataPath, accountA)).toBe(
      path.join(userDataPath, "data", "pglite"),
    );
    expect(await getWorkspaceDataDir(userDataPath, accountB)).toBe(
      path.join(userDataPath, "data", "workspaces", accountB),
    );
    expect(await getWorkspaceDataDir(userDataPath, accountA)).toBe(
      path.join(userDataPath, "data", "pglite"),
    );
  });

  it("uses an account workspace when no legacy workspace exists", async () => {
    const userDataPath = await userDataDir();
    expect(await getWorkspaceDataDir(userDataPath, accountA)).toBe(
      path.join(userDataPath, "data", "workspaces", accountA),
    );
  });

  it("rejects invalid account IDs", async () => {
    const userDataPath = await userDataDir();
    await expect(getWorkspaceDataDir(userDataPath, "not-a-uuid")).rejects.toThrow(
      "Invalid desktop account id",
    );
  });
});
