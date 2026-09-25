const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { shell } = require("electron");

const SESSION_FILE = "desktop-sync-session.bin";
const REVOCATION_FILE = "desktop-pending-revocations.bin";
const LOG_FILE = "desktop-sync.log";
const SYNC_INTERVAL_MS = 30_000;

function normalizeRemoteUrl(value) {
  return typeof value === "string" ? value.replace(/\/+$/, "") : "";
}

function createSyncManager({
  app,
  safeStorage,
  getWindow,
  getLocalContext,
  remoteUrl,
}) {
  const normalizedRemoteUrl = normalizeRemoteUrl(remoteUrl);
  const userDataPath = app.getPath("userData");
  const sessionPath = path.join(userDataPath, SESSION_FILE);
  const revocationPath = path.join(userDataPath, REVOCATION_FILE);
  const logPath = path.join(userDataPath, LOG_FILE);
  let token = null;
  let pendingAuthState = null;
  let pendingRevocations = [];
  let syncTimer = null;
  let syncing = false;
  let status = {
    state: "signed_out",
    pending: 0,
    conflicts: 0,
    lastSyncedAt: null,
    message: normalizedRemoteUrl
      ? "Sign in to sync this device."
      : "Configure HTML_DOCS_REMOTE_URL to enable cloud sync.",
  };

  async function writeLog(level, message) {
    const line = `${new Date().toISOString()} [${level}] ${message}\n`;
    if (level === "ERROR") console.error(line.trim());
    else console.log(line.trim());
    try {
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.appendFile(logPath, line, "utf8");
    } catch {
      // Logging must never prevent the sync worker from running.
    }
  }

  function publicStatus() {
    return {
      ...status,
      hasToken: Boolean(token),
      remoteConfigured: Boolean(normalizedRemoteUrl),
      persistent: safeStorage.isEncryptionAvailable(),
    };
  }

  function broadcast() {
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send("desktop:sync-status", publicStatus());
    }
  }

  function setStatus(next) {
    status = { ...status, ...next };
    broadcast();
  }

  async function loadPendingRevocations() {
    if (!safeStorage.isEncryptionAvailable()) return;
    try {
      const encrypted = await fs.readFile(revocationPath);
      const parsed = JSON.parse(safeStorage.decryptString(encrypted));
      if (Array.isArray(parsed)) {
        pendingRevocations = parsed.filter(
          (value) => typeof value === "string" && value.startsWith("dhd_"),
        );
      }
    } catch {
      pendingRevocations = [];
    }
  }

  async function persistPendingRevocations() {
    if (!safeStorage.isEncryptionAvailable()) return;
    if (pendingRevocations.length === 0) {
      await fs.rm(revocationPath, { force: true });
      return;
    }
    await fs.writeFile(
      revocationPath,
      safeStorage.encryptString(JSON.stringify(pendingRevocations)),
    );
  }

  async function revokeRemoteToken(value) {
    if (!normalizedRemoteUrl) return true;
    try {
      const response = await fetch(`${normalizedRemoteUrl}/desktop/auth/revoke`, {
        method: "POST",
        headers: { Authorization: `Bearer ${value}` },
        signal: AbortSignal.timeout(15_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function retryPendingRevocations() {
    if (!pendingRevocations.length) return;
    const remaining = [];
    for (const value of pendingRevocations) {
      if (!(await revokeRemoteToken(value))) remaining.push(value);
    }
    pendingRevocations = remaining;
    await persistPendingRevocations();
  }

  async function loadToken() {
    if (!safeStorage.isEncryptionAvailable()) return;
    try {
      const encrypted = await fs.readFile(sessionPath);
      token = safeStorage.decryptString(encrypted);
    } catch {
      token = null;
    }
    if (token) {
      setStatus({
        state: "signed_in",
        message: safeStorage.isEncryptionAvailable()
          ? "Ready to sync."
          : "Signed in for this session only; OS secure storage is unavailable.",
      });
    }
  }

  async function saveToken(nextToken) {
    token = nextToken;
    if (safeStorage.isEncryptionAvailable()) {
      await fs.mkdir(path.dirname(sessionPath), { recursive: true });
      await fs.writeFile(sessionPath, safeStorage.encryptString(token));
    }
    void writeLog("INFO", "Desktop session saved");
    setStatus({
      state: "signed_in",
      message: safeStorage.isEncryptionAvailable()
        ? "Signed in. Syncing shortly."
        : "Signed in for this session only; OS secure storage is unavailable.",
    });
  }

  async function clearToken() {
    pendingAuthState = null;
    let revocationPending = false;
    if (token && normalizedRemoteUrl) {
      const revoked = await revokeRemoteToken(token);
      if (!revoked) {
        revocationPending = true;
        if (!pendingRevocations.includes(token)) pendingRevocations.push(token);
        try {
          await persistPendingRevocations();
        } catch {
          // If secure storage is unavailable, the status below remains explicit.
        }
      }
    }
    token = null;
    try {
      await fs.rm(sessionPath, { force: true });
    } catch {
      // Ignore missing session files and filesystem races during shutdown.
    }
    void writeLog("INFO", "Desktop session cleared");
    setStatus({
      state: "signed_out",
      pending: 0,
      conflicts: 0,
      message: revocationPending
        ? safeStorage.isEncryptionAvailable()
          ? "Signed out locally; cloud sign-out will retry when online."
          : "Signed out locally; cloud sign-out could not be completed."
        : "Sign in to sync this device.",
    });
  }

  function authUrl(email) {
    const url = new URL(`${normalizedRemoteUrl}/desktop/auth`);
    if (email) url.searchParams.set("email", email);
    return url.toString();
  }

  async function startSignIn(email) {
    if (!normalizedRemoteUrl) {
      const message = "Cloud sync is not configured for this desktop build.";
      setStatus({ state: "error", message });
      void writeLog("ERROR", message);
      throw new Error(message);
    }
    pendingAuthState = randomBytes(32).toString("base64url");
    const url = new URL(authUrl(email));
    url.searchParams.set("state", pendingAuthState);
    await shell.openExternal(url.toString());
    void writeLog("INFO", "Desktop sign-in started");
    setStatus({ state: "awaiting_auth", message: "Check your browser to continue sign-in." });
  }

  async function parseSyncResponse(response) {
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { message: text };
    }
    if (!response.ok) {
      const error = new Error(payload.message || `Sync failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function callLocal(mode) {
    const local = getLocalContext();
    if (!local) throw new Error("The local desktop server is not ready.");
    return fetch(`${local.origin}/__desktop/sync?mode=${mode}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-HTML-DOCS-DESKTOP-TOKEN": local.token,
      },
      signal: AbortSignal.timeout(30_000),
    });
  }

  async function syncNow() {
    if (!token) {
      await retryPendingRevocations();
      setStatus({ state: "signed_out" });
      return;
    }
    if (!normalizedRemoteUrl) {
      setStatus({ state: "error", message: "Cloud sync is not configured." });
      return;
    }
    if (syncing) return;
    syncing = true;
    setStatus({ state: "syncing", message: "Syncing local documents…" });
    void writeLog("INFO", `Starting push/pull against ${normalizedRemoteUrl}`);

    try {
      const push = await parseSyncResponse(await callLocal("push"));
      void writeLog("INFO", `Push completed: ${JSON.stringify(push)}`);
      const pull = await parseSyncResponse(await callLocal("pull"));
      void writeLog("INFO", `Pull completed: ${JSON.stringify(pull)}`);
      const conflicts = [...(push.conflicts ?? []), ...(pull.conflicts ?? [])];
      const partial = Boolean(pull.partial);
      setStatus({
        state: conflicts.length ? "conflict" : partial ? "partial" : "synced",
        pending: 0,
        conflicts: conflicts.length,
        lastSyncedAt: new Date().toISOString(),
        message: conflicts.length
          ? `${conflicts.length} document${conflicts.length === 1 ? "" : "s"} need review.`
          : partial
            ? "More changes are waiting; sync will continue shortly."
            : "All local documents are synced.",
      });
    } catch (error) {
      void writeLog(
        "ERROR",
        `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (error.status === 401) {
        await clearToken();
        return;
      }
      setStatus({
        state: "error",
        message: error instanceof Error ? error.message : "Sync failed.",
      });
    } finally {
      syncing = false;
    }
  }

  async function redeemAuthorizationCode(code, state) {
    if (!pendingAuthState || state !== pendingAuthState) {
      throw new Error("Desktop sign-in state did not match.");
    }
    pendingAuthState = null;
    const response = await fetch(`${normalizedRemoteUrl}/desktop/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await parseSyncResponse(response);
    if (!payload.token || !String(payload.token).startsWith("dhd_")) {
      throw new Error("Desktop sign-in response was invalid.");
    }
    await saveToken(String(payload.token));
    await syncNow();
  }

  function handleProtocolUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "html-docs:") return false;
      if (url.hostname !== "auth" || url.pathname !== "/callback") return false;
      const error = url.searchParams.get("error");
      if (error) {
        setStatus({ state: "error", message: error });
        void writeLog("ERROR", `Desktop sign-in error: ${error}`);
        return true;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") || "";
      if (!code || !/^dac_[A-Za-z0-9_-]{43}$/.test(code)) {
        setStatus({ state: "error", message: "The desktop sign-in response was invalid." });
        void writeLog("ERROR", "Desktop sign-in response was invalid");
        return true;
      }
      void redeemAuthorizationCode(code, state).catch((error) => {
        setStatus({
          state: "error",
          message: error instanceof Error ? error.message : "Desktop sign-in failed.",
        });
        void writeLog(
          "ERROR",
          `Desktop sign-in failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      return true;
    } catch {
      return false;
    }
  }

  async function start() {
    await loadPendingRevocations();
    await loadToken();
    await retryPendingRevocations();
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
    await syncNow();
  }

  function stop() {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
  }

  return {
    start,
    stop,
    getStatus: publicStatus,
    startSignIn,
    clearToken,
    syncNow,
    handleProtocolUrl,
  };
}

module.exports = { createSyncManager };
