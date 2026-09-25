import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
const env = { ...process.env };

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

const remoteUrl = (env.HTML_DOCS_REMOTE_URL || env.APP_URL || "").replace(/\/+$/, "");
const configPath = resolve(root, "electron", "runtime-config.json");
mkdirSync(dirname(configPath), { recursive: true });
writeFileSync(
  configPath,
  `${JSON.stringify({ remoteUrl }, null, 2)}\n`,
  "utf8",
);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const build = spawnSync(npm, ["run", "build"], { cwd: root, stdio: "inherit", env });
if (build.status !== 0) process.exit(build.status ?? 1);

const packageBuild = spawnSync(
  npx,
  ["electron-builder", "--config", "electron-builder.yml"],
  { cwd: root, stdio: "inherit", env },
);
process.exit(packageBuild.status ?? 1);
