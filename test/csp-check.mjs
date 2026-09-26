#!/usr/bin/env node
/**
 * CSP Static Analyser — html-docs
 *
 * Parses each HTML fixture, extracts every external resource URL and
 * network call, then evaluates it against the *real* RAW_CSP policy from
 * app/lib/csp.server.ts.
 *
 * The policy is imported rather than mirrored, so the analyser cannot drift
 * away from what the server actually sends. Matching semantics live in
 * csp-policy.mjs and are covered by csp-policy.test.ts.
 *
 * Usage:  node test/csp-check.mjs
 *
 * Each fixture declares what it expects with an HTML marker:
 *   <!-- csp-expect: allowed -->   (the default) everything it references loads
 *   <!-- csp-expect: blocked -->   everything it reaches for is denied
 *
 * The gate checks that expectation in both directions, so a policy change that
 * either breaks a working document or silently permits a blocked one fails.
 * Exits non-zero on any failure, and on a malformed marker.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyFixture,
  directiveAllows,
  extractNetworkUrls,
  extractResourceUrls,
  parseCsp,
  readFixtureExpectation,
  EXPECT_BLOCKED,
} from "./csp-policy.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dir, "csp-fixtures");

// ─── Load the real policy ────────────────────────────────────────────────────
// csp.server.ts contains no TypeScript syntax, so Node can import it directly
// once type stripping is available (default from Node 22.18 / 23.6 / 24).
let RAW_CSP;
try {
  ({ RAW_CSP } = await import("../app/lib/csp.server.ts"));
} catch (error) {
  console.error(
    "Could not import app/lib/csp.server.ts.\n" +
      "Run this script on Node >= 22.18 (type stripping), or rely on `npm test`\n" +
      "which evaluates the same policy through Vitest.\n",
  );
  console.error(String(error?.message ?? error));
  process.exit(2);
}

const policy = parseCsp(RAW_CSP);

// ─── Sandbox restrictions (CSP sandbox, not a URL directive) ─────────────────
// sandbox="allow-scripts" WITHOUT allow-same-origin / allow-popups /
// allow-top-navigation means these APIs are unavailable to authored HTML.
const SANDBOX_BLOCKS = {
  localStorage: "no allow-same-origin",
  sessionStorage: "no allow-same-origin",
  indexedDB: "no allow-same-origin",
  "document.cookie": "no allow-same-origin",
  "window.open": "no allow-popups",
  "top.location": "no allow-top-navigation",
};

function analyse(html) {
  const blocked = [];
  const allowed = [];
  const sandboxed = [];

  const record = (directive, url, verdict) => {
    (verdict.allowed ? allowed : blocked).push({ directive, url, reason: verdict.reason });
  };

  // Subresources: script/style/img/frame/ESM imports.
  for (const { kind, url } of extractResourceUrls(html)) {
    record(kind, url, directiveAllows(kind, policy.get(kind), url));
  }

  // Network calls are evaluated against their real target URL rather than the
  // mere presence of an API. connect-src is not 'none' — it lists four CDNs.
  for (const { url } of extractNetworkUrls(html)) {
    record("connect-src", url, directiveAllows("connect-src", policy.get("connect-src"), url));
  }

  // Form posts.
  for (const m of html.matchAll(/<form[^>]+action=["']([^"']+)["']/gi)) {
    const action = m[1];
    if (action && action !== "#") {
      record("form-action", action, directiveAllows("form-action", policy.get("form-action"), action));
    }
  }

  // Structural directives with no URL to evaluate.
  if (/<iframe/i.test(html)) {
    blocked.push({
      directive: "frame-src",
      url: "<iframe> element",
      reason: "frame-src 'none'",
    });
  }

  for (const [api, reason] of Object.entries(SANDBOX_BLOCKS)) {
    if (html.includes(api)) {
      sandboxed.push({ api, reason });
    }
  }

  return { blocked, allowed, sandboxed };
}

// ─── Main ────────────────────────────────────────────────────────────────────
const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".html")).sort();

let totalPass = 0;
let totalWarn = 0;
let totalFail = 0;

console.log("\n╔══════════════════════════════════════════════════════════════════╗");
console.log("║         html-docs — CSP Static Analysis Report                  ║");
console.log("╚══════════════════════════════════════════════════════════════════╝");
console.log(`\n  Policy: ${RAW_CSP}\n`);

for (const file of files) {
  const html = readFileSync(join(FIXTURES_DIR, file), "utf8");

  let expectation;
  try {
    expectation = readFixtureExpectation(html);
  } catch (error) {
    console.log(`❌ ERROR ${file}`);
    console.log(`  ⚠️  ${error.message}\n`);
    totalFail++;
    continue;
  }

  const { blocked, allowed, sandboxed } = analyse(html);
  const verdict = classifyFixture(expectation, { blocked, allowed, sandboxed });

  const marker = expectation === EXPECT_BLOCKED ? " [expects blocked]" : "";
  const icon = verdict.status === "fail" ? "❌ FAIL" : verdict.status === "warn" ? "⚠️  WARN" : "✅ PASS";
  if (verdict.status === "fail") totalFail++;
  else if (verdict.status === "warn") totalWarn++;
  else totalPass++;

  console.log(`${icon}  ${file}${marker}`);

  for (const a of verdict.allowed) console.log(`       ✓ [${a.directive}] ${a.url}`);
  for (const b of verdict.blocked) console.log(`  🚫 [${b.directive}] ${b.url}  →  ${b.reason}`);
  for (const s of verdict.sandboxed) console.log(`  ⚠️  [sandbox] ${s.api}  →  blocked: ${s.reason}`);
  for (const problem of verdict.problems) console.log(`  ⛔ ${problem}`);
  if (!verdict.allowed.length && !verdict.blocked.length && !verdict.sandboxed.length) {
    console.log("       (no external resources)");
  }
  console.log();
}

console.log("─────────────────────────────────────────────────────────────────");
console.log(
  `  Fixtures: ${files.length}   ✅ Pass: ${totalPass}   ⚠️  Warn: ${totalWarn}   ❌ Fail: ${totalFail}`,
);
console.log("─────────────────────────────────────────────────────────────────");
console.log(
  totalFail
    ? `\n  ${totalFail} fixture(s) did not match their declared expectation.\n`
    : "\n  Every fixture matches its declared expectation.\n",
);

// Gate: a fixture must match what it declares, in either direction.
process.exit(totalFail > 0 ? 1 : 0);
