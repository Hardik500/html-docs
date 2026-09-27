import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeRemoteUrl } = require("../electron/remote-url.cjs");

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

const remoteUrl = normalizeRemoteUrl(env.HTML_DOCS_REMOTE_URL || env.APP_URL || "", {
  allowHttpLoopback: false,
});
if (env.DESKTOP_REQUIRE_REMOTE_URL === "1" && !remoteUrl) {
  console.error("HTML_DOCS_REMOTE_URL is required for this desktop build.");
  process.exit(1);
}
const configPath = resolve(root, "electron", "runtime-config.json");
mkdirSync(dirname(configPath), { recursive: true });
writeFileSync(
  configPath,
  `${JSON.stringify({ remoteUrl }, null, 2)}\n`,
  "utf8",
);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

// Windows only. npm and npx are .cmd shims there, and Node will not execute a
// .cmd/.bat without a shell -- the documented invocation is
// `spawn('"my script.cmd" a b', { shell: true })`. Without this the spawn never
// starts and desktop:dist exits 1 on windows-latest having printed nothing at
// all, which is how this went unnoticed for as long as it did.
//
// Scoped to win32 on purpose: on Linux and macOS a shell is not required, so
// those platforms keep a direct exec and their behaviour is unchanged. Every
// argument here is a static literal with no spaces or shell metacharacters, so
// nothing is re-interpreted by the shell.
const shell = process.platform === "win32";

/**
 * Runs a command, and never exits silently.
 *
 * spawnSync reports a failure to *launch* through `error`, with `status` left
 * null. Checking only `status` and then `process.exit(status ?? 1)` turns a
 * launch failure into a bare exit code with no message, which is precisely why
 * the Windows failure above had to be diagnosed from the absence of output.
 */
function run(label, command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env, shell });
  if (result.error) {
    console.error(`${label}: could not start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`${label}: ${command} was terminated by ${result.signal}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("build", npm, ["run", "build"]);

// --publish never is explicit on purpose. electron-builder.yml sets no
// `publish` key, and when it is undefined electron-builder infers one from the
// environment: on CI it escalates to "onTagOrDraft" and tries to create a draft
// GitHub release. That is not what this build is for — the workflow uploads the
// archive with actions/upload-artifact — and without a token it fails at the very
// last step, *after* a working installer has been produced:
//
//   building embedded block map  file=release/html-docs-0.1.0.AppImage
//   Implicit publishing triggered by CI detection.
//   GitHub Personal Access Token is not set, neither programmatically, nor
//   using env "GH_TOKEN"
//
// Being explicit also stops this depending on an inference that upstream has
// already deprecated ("this behavior will be disabled in electron-builder v27").
// Nothing that works today is lost: publishing is currently impossible without a
// token, so the build has never succeeded at this step. If releases are ever
// wanted from CI, that is a deliberate change with a token attached, not an
// accident of detection.
run("package", npx, ["electron-builder", "--config", "electron-builder.yml", "--publish", "never"]);
