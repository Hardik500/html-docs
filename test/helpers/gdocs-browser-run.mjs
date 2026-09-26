/**
 * Test-only helper: runs real-browser checks in a headless Chromium.
 *
 * Why this exists: @tiptap/core's `generateJSON`/`generateHTML` require a DOM,
 * and this repo has no jsdom / happy-dom / linkedom installed. Rather than
 * mock TipTap, we bundle the REAL DocEditor extension set with esbuild and run
 * it inside the headless Chromium that ships in the Playwright cache
 * (the same browser `scripts/verify-raw-isolation.mjs` uses).
 *
 * It also imports the real app/lib helpers (docToHtml, injectPreviewCsp,
 * injectDefaultStyles) so the "Google Docs Webpage export stored as a doc tab"
 * question can be answered against an actual DOM parse instead of a regex.
 *
 * Nothing under app/ is modified; this only bundles and inspects.
 */
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not `new URL(...).pathname`: the latter is a POSIX-shaped
// "/D:/a/repo" on Windows, and every path built from it then carries a doubled
// drive letter. See the same fix in test/gdocs-content.test.ts.
const REPO = resolve(fileURLToPath(new URL("../../", import.meta.url)));

/**
 * Candidate executable basenames, most preferred first. A headless shell is
 * preferred over a full browser: the harness only ever runs the binary
 * headless, and the shell is the smaller download.
 */
const BROWSER_BINARIES = ["headless_shell", "chrome-headless-shell", "chrome"];

/**
 * Every Playwright-executable-looking file under one cache directory, at any
 * depth. An interrupted download has no executable, so a hit also proves the
 * install finished.
 */
function executablesUnder(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isFile() || !BROWSER_BINARIES.includes(entry.name)) continue;
    const path = join(entry.parentPath ?? entry.path ?? dir, entry.name);
    try {
      accessSync(path, constants.X_OK);
      found.push(path);
    } catch {
      // Not executable, so not the browser.
    }
  }
  return found;
}

/**
 * Resolves a usable Chromium, or null when there is none.
 *
 * Exported so a test can SKIP rather than fail when no browser is present.
 * `runInBrowser` throws, which is right for a real assertion failure but wrong
 * for "this machine has no browser": a fresh clone or a CI runner that has not
 * installed one, and that is an environment fact, not a broken test.
 *
 * The cache layout is NOT hardcoded. Playwright has shipped at least three
 * different ones, and hardcoding one is a silent failure: the directory
 * chromium_headless_shell-1194/chrome-headless-shell-linux64/chrome-headless-shell
 * from an older revision is chromium_headless_shell-1194/chrome-linux/headless_shell
 * today. The first version of this helper hardcoded the old paths, so a CI
 * install of the current Playwright "succeeded" and the test still skipped --
 * green for the wrong reason. So each chromium* cache entry is searched by
 * executable name at any depth, newest entry first. `CHROME_PATH` overrides.
 */
export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const cache = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(cache)) return null;
  const entries = readdirSync(cache)
    .filter((d) => d.startsWith("chromium"))
    .sort()
    .reverse();
  for (const entry of entries) {
    const hits = executablesUnder(join(cache, entry));
    for (const name of BROWSER_BINARIES) {
      const hit = hits.find((p) => p.endsWith("/" + name));
      if (hit) return hit;
    }
  }
  return null;
}

const ENTRY_SOURCE = `
import { generateJSON, generateHTML } from ${JSON.stringify(REPO + "/node_modules/@tiptap/core/dist/index.js")};
import StarterKit from ${JSON.stringify(REPO + "/node_modules/@tiptap/starter-kit/dist/index.js")};
import Image from ${JSON.stringify(REPO + "/node_modules/@tiptap/extension-image/dist/index.js")};
import { TableKit } from ${JSON.stringify(REPO + "/node_modules/@tiptap/extension-table/dist/index.js")};
import { docToHtml } from ${JSON.stringify(REPO + "/app/lib/doc.ts")};
import { injectPreviewCsp } from ${JSON.stringify(REPO + "/app/lib/preview-csp.ts")};
import { injectDefaultStyles } from ${JSON.stringify(REPO + "/app/lib/htmlDefaults.ts")};

// Exactly app/components/DocEditor.tsx:185
const extensions = [
  StarterKit,
  Image.configure({ allowBase64: true }),
  TableKit.configure({ table: { resizable: true } }),
];

const enc = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};

function tiptap(name, html) {
  try {
    const json = generateJSON(html, extensions);
    return { name, kind: "tiptap", ok: true, json, roundTrip: generateHTML(json, extensions) };
  } catch (error) {
    return { name, kind: "tiptap", ok: false, error: String((error && error.message) || error) };
  }
}

// Resolves a stored tab exactly like the app does, then inspects how a real
// browser parses the result.
function inspect(name, stored, opts) {
  const doc = docToHtml(stored);
  // preview:true mirrors PreviewIframe; otherwise it mirrors
  // raw.$docId.$tabSlug.tsx, which injects defaults but relies on the RAW_CSP
  // response header instead of a meta tag.
  const resolved = (opts && opts.preview
    ? injectDefaultStyles(injectPreviewCsp(doc), false)
    : injectDefaultStyles(doc)) + ((opts && opts.extraInject) || "");
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    // allow-same-origin so the harness can read the parsed document back out.
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.style.cssText = "width:800px;height:600px";
    frame.srcdoc = resolved;
    frame.onload = () => {
      let win = null;
      try { win = frame.contentWindow; } catch {}
      const d = win && win.document;
      if (!d) { resolve({ name, kind: "document", ok: false, error: "no document" }); return; }
      const styles = Array.from(d.querySelectorAll("style")).map((s) => ({
        inHead: !!(s.parentElement && s.parentElement.tagName === "HEAD"),
        parentTag: s.parentElement ? s.parentElement.tagName : null,
        rules: (() => { try { return s.sheet ? s.sheet.cssRules.length : -1; } catch { return -2; } })(),
      }));
      const marker = d.querySelector(".gdocs-marker");
      resolve({
        name, kind: "document", ok: true,
        resolved,
        htmlElements: d.querySelectorAll("html").length,
        headElements: d.querySelectorAll("head").length,
        bodyElements: d.querySelectorAll("body").length,
        docTitle: d.title,
        titleElements: Array.from(d.querySelectorAll("title")).map((t) => t.textContent),
        titleParents: Array.from(d.querySelectorAll("title")).map((t) =>
          t.parentElement ? t.parentElement.tagName : null),
        styleElements: d.querySelectorAll("style").length,
        linkElements: d.querySelectorAll("link").length,
        scriptElements: d.querySelectorAll("script").length,
        styles,
        markerColor: marker ? win.getComputedStyle(marker).color : null,
        bodyText: (d.body && d.body.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 300),
        h1Text: Array.from(d.querySelectorAll("h1")).map((h) => h.textContent),
      });
    };
    document.body.appendChild(frame);
  });
}

// Renders arbitrary HTML and reports the *computed* style of its first <p>, so
// "the style attribute was dropped" can be turned into "the browser now
// collapses the spacing" rather than asserted by inspection.
function render(name, html) {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    frame.srcdoc = injectDefaultStyles("<!doctype html><html><head></head><body>" + html + "</body></html>", false);
    frame.onload = () => {
      const win = frame.contentWindow;
      const d = win.document;
      const p = d.querySelector("p");
      const cs = p ? win.getComputedStyle(p) : null;
      // Two spans with identical multi-space text: one with pre-wrap, one without.
      const a = d.createElement("span");
      a.textContent = "alpha    beta";
      a.style.whiteSpace = "pre-wrap";
      const b = d.createElement("span");
      b.textContent = "alpha    beta";
      d.body.appendChild(a); d.body.appendChild(b);
      resolve({
        name, kind: "render", ok: true,
        paragraphWhiteSpace: cs ? cs.whiteSpace : null,
        paragraphFontFamily: cs ? cs.fontFamily : null,
        preWrapWidth: a.getBoundingClientRect().width,
        collapsedWidth: b.getBoundingClientRect().width,
        bodyText: (d.body.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200),
      });
    };
    document.body.appendChild(frame);
  });
}

(async () => {
  const fixtures = JSON.parse(document.getElementById("fixtures").textContent);
  const results = [];
  for (const f of fixtures) {
    if (f.kind === "tiptap") results.push(tiptap(f.name, f.html));
    else if (f.kind === "render") results.push(await render(f.name, f.html));
    else results.push(await inspect(f.name, f.stored, f));
  }
  document.getElementById("out").textContent = enc(JSON.stringify(results));
  document.title = "DONE";
})();
`;

function buildPage(dir, fixtures) {
  const entry = join(dir, "entry.js");
  writeFileSync(entry, ENTRY_SOURCE);
  execFileSync(join(REPO, "node_modules/.bin/esbuild"), [
    entry, "--bundle", "--format=iife", `--outfile=${join(dir, "bundle.js")}`, "--log-level=warning",
  ], { stdio: "inherit" });

  const fixtureJson = JSON.stringify(fixtures).replace(/</g, "\\u003c");
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>pending</title></head><body>` +
    `<pre id="out">PENDING</pre>` +
    `<script>window.addEventListener("error",function(e){document.getElementById("out").textContent="ERR:"+e.message;});</script>` +
    `<script type="application/json" id="fixtures">${fixtureJson}</script>` +
    `<script src="bundle.js"></script></body></html>`;
  writeFileSync(join(dir, "index.html"), html);
}

/**
 * @param {Array<object>} fixtures
 *   {kind:"tiptap", name, html}                    -> parse + reserialize with DocEditor's schema
 *   {kind:"document", name, contentType, stored}   -> resolve like the app, then inspect the DOM
 * @returns {Array<object>}
 */
export function runInBrowser(fixtures) {
  const chrome = findChrome();
  if (!chrome) {
    throw new Error(
      "No headless Chromium found. Set CHROME_PATH to a Chrome/Chromium binary. " +
      `Looked in ${join(homedir(), ".cache", "ms-playwright")} and process.env.CHROME_PATH.`,
    );
  }
  const dir = mkdtempSync(join(tmpdir(), "html-docs-gdocs-"));
  mkdirSync(dir, { recursive: true });
  buildPage(dir, fixtures);

  const dom = execFileSync(
    chrome,
    [
      "--no-sandbox",
      "--user-data-dir=" + join(dir, "profile"),
      "--allow-file-access-from-files",
      "--virtual-time-budget=30000",
      "--dump-dom",
      "file://" + join(dir, "index.html"),
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], timeout: 120000 },
  );

  const m = /<pre id="out">([A-Za-z0-9+/=]*)<\/pre>/.exec(dom);
  if (!m) throw new Error("browser produced no <pre id=out>; dom head: " + dom.slice(0, 1200));
  if (m[1] === "PENDING") throw new Error("browser harness did not finish; dom head: " + dom.slice(0, 2000));
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  if (decoded.startsWith("ERR:")) throw new Error("browser harness threw: " + decoded);
  return JSON.parse(decoded);
}
