const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const path = require("node:path");

const ACCOUNT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertAccountId(accountId) {
  if (typeof accountId !== "string" || !ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error("Invalid desktop account id");
  }
}

async function readState(statePath) {
  try {
    const value = JSON.parse(await fs.readFile(statePath, "utf8"));
    return {
      activeAccountId:
        typeof value.activeAccountId === "string" ? value.activeAccountId : null,
      legacyAccountId:
        typeof value.legacyAccountId === "string" ? value.legacyAccountId : null,
    };
  } catch {
    return { activeAccountId: null, legacyAccountId: null };
  }
}

/**
 * Select an account-isolated PGlite directory while preserving the legacy
 * directory for the first account that uses it.
 */
async function getWorkspaceDataDir(userDataPath, requestedAccountId) {
  const dataRoot = path.join(userDataPath, "data");
  const legacyDir = path.join(dataRoot, "pglite");
  const statePath = path.join(dataRoot, "workspace-state.json");
  await fs.mkdir(dataRoot, { recursive: true });

  if (requestedAccountId) assertAccountId(requestedAccountId);

  const state = await readState(statePath);
  const accountId = requestedAccountId || state.activeAccountId;
  let changed = false;

  if (requestedAccountId && state.activeAccountId !== requestedAccountId) {
    state.activeAccountId = requestedAccountId;
    changed = true;
  }

  if (accountId && !state.legacyAccountId && existsSync(legacyDir)) {
    assertAccountId(accountId);
    state.legacyAccountId = accountId;
    changed = true;
  }

  if (changed) {
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  if (!accountId || state.legacyAccountId === accountId) return legacyDir;
  return path.join(dataRoot, "workspaces", accountId);
}

module.exports = { getWorkspaceDataDir };
