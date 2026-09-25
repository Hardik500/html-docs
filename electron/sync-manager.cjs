const fs = require("node:fs/promises");
const path = require("node:path");
const { shell } = require("electron");

const SESSION_FILE = "desktop-sync-session.bin";
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
  const sessionPath = path.join(app.getPath("userData"), SESSION_FILE);
  let token = null;
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

  async function loadToken() {
    if (!safeStorage.isEncryptionAvailable()) return;
    try {
      const encrypted = await fs.readFile(sessionPath);
      token = safeStorage.decryptString(encrypted);
    } catch {
      token = null;
    }
    if (token) setStatus({ state: "signed_in", message: "Ready to sync." });
  }

  async function saveToken(nextToken) {
    token = nextToken;
    if (safeStorage.isEncryptionAvailable()) {
      await fs.mkdir(path.dirname(sessionPath), { recursive: true });
      await fs.writeFile(sessionPath, safeStorage.encryptString(token));
    }
    setStatus({ state: "signed_in", message: "Signed in. Syncing shortly." });
  }

  async function clearToken() {
    if (token && normalizedRemoteUrl) {
      try {
        await fetch(`${normalizedRemoteUrl}/desktop/auth/revoke`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Local sign-out must still work while offline.
      }
    }
    token = null;
    try {
      await fs.rm(sessionPath, { force: true });
    } catch {
      // Ignore missing session files and filesystem races during shutdown.
    }
    setStatus({
      state: "signed_out",
      pending: 0,
      conflicts: 0,
      message: "Sign in to sync this device.",
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
      throw new Error(message);
    }
    await shell.openExternal(authUrl(email));
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
    });
  }

  async function syncNow() {
    if (!token) {
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

    try {
      const push = await parseSyncResponse(await callLocal("push"));
      const pull = await parseSyncResponse(await callLocal("pull"));
      const conflicts = [...(push.conflicts ?? []), ...(pull.conflicts ?? [])];
      setStatus({
        state: conflicts.length ? "conflict" : "synced",
        pending: 0,
        conflicts: conflicts.length,
        lastSyncedAt: new Date().toISOString(),
        message: conflicts.length
          ? `${conflicts.length} document${conflicts.length === 1 ? "" : "s"} need review.`
          : "All local documents are synced.",
      });
    } catch (error) {
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

  function handleProtocolUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "html-docs:") return false;
      if (url.hostname !== "auth" || url.pathname !== "/callback") return false;
      const error = url.searchParams.get("error");
      if (error) {
        setStatus({ state: "error", message: error });
        return true;
      }
      const nextToken = url.searchParams.get("token");
      if (!nextToken || !nextToken.startsWith("dhd_")) {
        setStatus({ state: "error", message: "The desktop sign-in response was invalid." });
        return true;
      }
      void saveToken(nextToken).then(() => syncNow());
      return true;
    } catch {
      return false;
    }
  }

  function start() {
    void loadToken().then(() => syncNow());
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
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
