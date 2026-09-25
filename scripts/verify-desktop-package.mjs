import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile } from "@electron/asar";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeRemoteUrl } = require("../electron/remote-url.cjs");

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseDir = resolve(root, "release");

function findAppAsar(directory) {
  if (!existsSync(directory)) return null;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isFile() && entry.name === "app.asar") return entryPath;
    if (entry.isDirectory()) {
      const found = findAppAsar(entryPath);
      if (found) return found;
    }
  }
  return null;
}

const archive = findAppAsar(releaseDir);
if (!archive) {
  throw new Error("No packaged app.asar found under release/");
}

const config = JSON.parse(
  extractFile(archive, "electron/runtime-config.json").toString("utf8"),
);
if (config.remoteUrl && typeof config.remoteUrl !== "string") {
  throw new Error("Packaged desktop remote URL must be a string");
}
const remoteUrl = config.remoteUrl
  ? normalizeRemoteUrl(config.remoteUrl, { allowHttpLoopback: false })
  : "";
if (process.env.DESKTOP_REQUIRE_REMOTE_URL === "1" && !remoteUrl) {
  throw new Error("Packaged desktop app has an empty remote URL");
}

const packageJson = JSON.parse(extractFile(archive, "package.json").toString("utf8"));
if (packageJson.main !== "electron/main.cjs") {
  throw new Error(`Unexpected packaged Electron entry: ${packageJson.main}`);
}

console.log(`Verified ${archive}: remoteUrl=${remoteUrl || "(local-only)"}`);
