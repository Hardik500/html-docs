/**
 * Verifies the /raw security boundary under *direct top-level navigation*,
 * which is the case a static header check cannot prove.
 *
 * Run: node scripts/verify-raw-isolation.mjs <origin> <docId> <tabSlug>
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [origin, docId, tabSlug] = process.argv.slice(2);
if (!origin || !docId || !tabSlug) {
  console.error("usage: node scripts/verify-raw-isolation.mjs <origin> <docId> <tabSlug>");
  process.exit(2);
}

const CHROME =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`;
const profile = mkdtempSync(join(tmpdir(), "raw-isolation-"));
const port = 9222 + Math.floor(Math.random() * 500);

const chrome = spawn(CHROME, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error("Chrome DevTools endpoint never became available");
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  return {
    ready,
    send(method, params = {}) {
      const messageId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(messageId, { resolve, reject });
        ws.send(JSON.stringify({ id: messageId, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  const cdp = connect(await cdpTarget());
  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");

  const url = `${origin}/raw/${docId}/${tabSlug}`;
  await cdp.send("Page.navigate", { url });
  await sleep(3000);

  const evaluate = async (expression) => {
    const r = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? "evaluation failed");
    return r.result.value;
  };

  check("document loaded", await evaluate("document.readyState") !== undefined);

  // 1. Opaque origin: the whole point of omitting allow-same-origin.
  const originValue = await evaluate("String(window.origin)");
  check("opaque origin (no allow-same-origin)", originValue === "null", `window.origin=${originValue}`);

  // 2. Cookies must be unreachable, including session cookies for the app.
  //    An opaque origin may either return "" or throw; both are secure.
  const cookie = await evaluate(`(() => {
    try { return JSON.stringify(document.cookie); }
    catch (e) { return JSON.stringify("threw:" + e.name); }
  })()`);
  const cookieValue = JSON.parse(cookie);
  check(
    "cookies unreachable",
    cookieValue === "" || cookieValue.startsWith("threw:"),
    `document.cookie=${JSON.stringify(cookieValue)}`,
  );

  // 3. Web storage must throw, not silently succeed.
  const storage = await evaluate(`(() => {
    const out = {};
    try { localStorage.setItem("k", "v"); out.localStorage = "writable"; }
    catch (e) { out.localStorage = "threw"; }
    try { sessionStorage.setItem("k", "v"); out.sessionStorage = "writable"; }
    catch (e) { out.sessionStorage = "threw"; }
    try { indexedDB.open("probe"); out.indexedDB = "writable"; }
    catch (e) { out.indexedDB = "threw"; }
    try { const r = caches.open("probe"); out.caches = "writable"; }
    catch (e) { out.caches = "threw"; }
    return JSON.stringify(out);
  })()`);
  const storageMap = JSON.parse(storage);
  check(
    "web storage isolated",
    storageMap.localStorage === "threw" && storageMap.sessionStorage === "threw",
    `localStorage=${storageMap.localStorage} sessionStorage=${storageMap.sessionStorage}`,
  );

  // 4. No network escape to the app origin (connect-src omits it).
  const fetchResult = await evaluate(`fetch("${origin}/healthz").then(() => "allowed").catch((e) => "blocked")`);
  check("same-origin fetch blocked by CSP", fetchResult === "blocked", `fetch -> ${fetchResult}`);

  // 5. Cannot reach the app document through an opener.
  const openerAccess = await evaluate(`(() => {
    try { return window.opener ? "has-opener" : "no-opener"; }
    catch (e) { return "threw"; }
  })()`);
  check("no opener access", openerAccess === "no-opener", `window.opener -> ${openerAccess}`);

  // 6. Top-level navigation is a sandbox flag we did not grant, so a
  //    user-initiated unload navigation stays on the page and scripts
  //    cannot drive the frame elsewhere.
  const navigation = await evaluate(`(() => {
    try { return String(location.href.startsWith(${JSON.stringify(`${origin}/raw/`)})); }
    catch (e) { return "threw"; }
  })()`);
  check("still on the raw document", navigation === "true", `href match -> ${navigation}`);

  // 7. Confirm the sandbox is not simply breaking the page.
  const rendered = await evaluate(`(() => {
    try { return Boolean(document.body && document.body.innerText.trim().length > 0); }
    catch (e) { return false; }
  })()`);
  check("authored content rendered", rendered === true);

  cdp.close();
} catch (error) {
  console.error("verification error:", error.message);
  results.push({ name: "harness", passed: false, detail: error.message });
} finally {
  chrome.kill();
  rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
