const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  session,
  shell,
} = require("electron");
const fs = require("node:fs/promises");
const { existsSync, readFileSync } = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { createSyncManager } = require("./sync-manager.cjs");
const { normalizeRemoteUrl } = require("./remote-url.cjs");
const { getWorkspaceDataDir } = require("./workspace.cjs");

let mainWindow = null;
let localServer = null;
let syncManager = null;
let syncManagerReady = false;
let localContext = null;
let pendingProtocolUrl = null;
let closingLocalServer = false;
let appOrigin = "";
let appToken = "";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function canOpenExternally(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function openExternal(value) {
  if (canOpenExternally(value)) void shell.openExternal(value);
}

function loadDevelopmentEnv(appRoot) {
  if (app.isPackaged) return;
  const envPath = path.join(appRoot, ".env");
  if (!existsSync(envPath) || typeof process.loadEnvFile !== "function") return;
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    console.warn("[desktop] could not load .env", error);
  }
}

function getRemoteUrl(appRoot) {
  loadDevelopmentEnv(appRoot);

  let configuredValue = "";
  if (!app.isPackaged) {
    configuredValue = process.env.HTML_DOCS_REMOTE_URL || process.env.APP_URL || "";
  }

  if (!configuredValue) {
    const configPath = path.join(appRoot, "electron", "runtime-config.json");
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, "utf8"));
        if (typeof config.remoteUrl === "string") configuredValue = config.remoteUrl;
      } catch (error) {
        throw new Error(`[desktop] could not read runtime config: ${error.message}`);
      }
    }
  }

  if (!configuredValue && app.isPackaged) {
    configuredValue = process.env.HTML_DOCS_REMOTE_URL || process.env.APP_URL || "";
  }

  return normalizeRemoteUrl(configuredValue, {
    allowHttpLoopback: !app.isPackaged,
  });
}

function registerProtocolClient() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("html-docs", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient("html-docs");
  }
}

async function startLocalServer({ dataDir } = {}) {
  const resolvedDataDir =
    dataDir || (await getWorkspaceDataDir(app.getPath("userData")));
  await fs.mkdir(resolvedDataDir, { recursive: true });

  const port = await getFreePort();
  const token = crypto.randomBytes(32).toString("hex");
  const appRoot = app.isPackaged
    ? app.getAppPath()
    : path.resolve(__dirname, "..");
  const serverBuildPath = path.join(appRoot, "build", "server", "index.js");
  const assetsBuildDirectory = path.join(appRoot, "build", "client");
  const localServerPath = path.join(__dirname, "local-server.mjs");
  const publicDirectory = path.join(appRoot, "public");
  const remoteUrl = getRemoteUrl(appRoot);

  process.env.HTML_DOCS_RUNTIME = "desktop";
  process.env.HTML_DOCS_DATA_DIR = resolvedDataDir;
  process.env.HTML_DOCS_DESKTOP_TOKEN = token;
  process.env.HTML_DOCS_SYNC_URL = remoteUrl;
  process.env.NODE_ENV = "production";

  const { startLocalServer: startServer } = await import(
    pathToFileURL(localServerPath).href
  );
  const server = await startServer({
    port,
    token,
    serverBuildPath,
    assetsBuildDirectory,
    publicDirectory,
  });

  localServer = server;
  localContext = { origin: server.origin, token, dataDir: resolvedDataDir };
  appOrigin = server.origin;
  appToken = token;
  return server;
}

function isAppUrl(value, origin) {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

function createPreviewWindow(url) {
  const preview = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#faf9f5",
    title: "html-docs preview",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  preview.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    if (isAppUrl(nextUrl, appOrigin)) createPreviewWindow(nextUrl);
    else openExternal(nextUrl);
    return { action: "deny" };
  });
  preview.webContents.on("will-navigate", (event, nextUrl) => {
    if (isAppUrl(nextUrl, appOrigin)) return;
    event.preventDefault();
    openExternal(nextUrl);
  });
  void preview.loadURL(url);
}

async function authorizeWindow(window, origin, token) {
  await session.defaultSession.cookies.set({
    url: `${origin}/`,
    name: "html_docs_desktop",
    value: token,
    httpOnly: true,
    sameSite: "strict",
    path: "/",
  });
  await window.loadURL(`${origin}/`);
}

function createWindow({ origin, token }) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#faf9f5",
    title: "html-docs",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  const contents = mainWindow.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url, origin)) createPreviewWindow(url);
    else openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (url.startsWith(`${origin}/`) || url === origin) return;
    event.preventDefault();
    openExternal(url);
  });
  contents.on("will-redirect", (event, url) => {
    if (url.startsWith(`${origin}/`) || url === origin) return;
    event.preventDefault();
    openExternal(url);
  });
  contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return;
    console.error(`[desktop] failed to load ${validatedURL}: ${errorDescription}`);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void authorizeWindow(mainWindow, origin, token).catch((error) => {
    console.error("[desktop] failed to load the local app", error);
  });
}

async function switchLocalWorkspace(accountId) {
  if (!localServer) return;

  const dataDir = await getWorkspaceDataDir(app.getPath("userData"), accountId);
  if (localContext?.dataDir === dataDir) return;

  const previousServer = localServer;
  localServer = null;
  await previousServer.close();
  const server = await startLocalServer({ dataDir });

  if (mainWindow && !mainWindow.isDestroyed()) {
    await authorizeWindow(mainWindow, server.origin, appToken);
  }
}

function configureDownloads() {
  session.defaultSession.on("will-download", (_event, item) => {
    void dialog
      .showSaveDialog({
        title: "Save document",
        defaultPath: item.getFilename(),
      })
      .then(({ canceled, filePath }) => {
        if (canceled || !filePath) {
          item.cancel();
          return;
        }
        item.setSavePath(filePath);
      })
      .catch(() => item.cancel());
  });
}

async function launch() {
  const appRoot = app.isPackaged
    ? app.getAppPath()
    : path.resolve(__dirname, "..");
  const remoteUrl = getRemoteUrl(appRoot);
  process.env.HTML_DOCS_SYNC_URL = remoteUrl;

  syncManager = createSyncManager({
    app,
    safeStorage,
    getWindow: () => mainWindow,
    getLocalContext: () => localContext,
    remoteUrl,
    onAccountChanged: switchLocalWorkspace,
  });
  await syncManager.initialize();

  const dataDir = await getWorkspaceDataDir(
    app.getPath("userData"),
    syncManager.getAccountId() || undefined,
  );
  const server = await startLocalServer({ dataDir });
  await syncManager.start();
  syncManagerReady = true;
  if (pendingProtocolUrl) {
    syncManager.handleProtocolUrl(pendingProtocolUrl);
    pendingProtocolUrl = null;
  }
  createWindow({ origin: server.origin, token: appToken });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (syncManager && syncManagerReady) syncManager.handleProtocolUrl(url);
    else pendingProtocolUrl = url;
  });

  app.on("second-instance", (_event, argv) => {
    const protocolUrl = argv.find((value) => value.startsWith("html-docs://"));
    if (protocolUrl) {
      if (syncManager && syncManagerReady) syncManager.handleProtocolUrl(protocolUrl);
      else pendingProtocolUrl = protocolUrl;
    }
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("com.html-docs.app");
    registerProtocolClient();

    ipcMain.handle("desktop:start-sign-in", async (_event, email) => {
      if (!syncManager) throw new Error("Desktop sync is not ready");
      await syncManager.startSignIn(
        typeof email === "string" ? email.trim() : undefined,
      );
      return syncManager.getStatus();
    });
    ipcMain.handle("desktop:get-sync-status", () => syncManager?.getStatus());
    ipcMain.handle("desktop:sync-now", async () => {
      await syncManager?.syncNow();
      return syncManager?.getStatus();
    });
    ipcMain.handle("desktop:sign-out", async () => {
      await syncManager?.clearToken();
      return syncManager?.getStatus();
    });
    ipcMain.handle("desktop:open-files", async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Open documents",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Supported documents",
            extensions: ["html", "htm", "md", "markdown", "docx", "pdf"],
          },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (result.canceled) return [];

      const files = [];
      for (const filePath of result.filePaths) {
        const data = await fs.readFile(filePath);
        if (data.byteLength > 10 * 1024 * 1024) {
          throw new Error(`${path.basename(filePath)} is larger than 10 MB`);
        }
        files.push({
          name: path.basename(filePath),
          dataBase64: data.toString("base64"),
        });
      }
      return files;
    });

    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    configureDownloads();

    try {
      await launch();
    } catch (error) {
      console.error("[desktop] failed to start", error);
      app.quit();
      return;
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0 && appOrigin) {
        createWindow({ origin: appOrigin, token: appToken });
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (syncManager) syncManager.stop();
    if (!localServer || closingLocalServer) return;
    event.preventDefault();
    closingLocalServer = true;
    void localServer.close().finally(() => {
      localServer = null;
      app.quit();
    });
  });
}
