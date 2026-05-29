#!/usr/bin/env node
/**
 * CSP Static Analyser — html-docs
 *
 * Parses each HTML fixture, extracts every external resource URL and
 * risky API usage, then checks them against the current RAW_CSP policy.
 * No browser required — pure static analysis.
 *
 * Usage:  node test/csp-check.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dir, 'csp-fixtures');

// ─── Mirror of app/lib/csp.server.ts ────────────────────────────────────────
const ALLOWED_SCRIPT_ORIGINS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com',
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com',
  'https://cdn.skypack.dev',
];
const ALLOWED_STYLE_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://unpkg.com',
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com',
];
const ALLOWED_FONT_ORIGINS = ['https://fonts.gstatic.com'];
// img-src https: data:  — any https OK
// connect-src 'none'   — no fetch/XHR/WS
// frame-src 'none'     — no nested iframes
// form-action 'none'   — no form posts

// ─── Sandbox restrictions (not CSP but equally important) ───────────────────
// sandbox="allow-scripts" WITHOUT allow-same-origin:
//   - localStorage / sessionStorage / cookies → SecurityError
//   - window.open / target="_blank" → blocked (no allow-popups)
//   - document.cookie → SecurityError
const SANDBOX_BLOCKS = ['localStorage', 'sessionStorage', 'document.cookie', 'window.open', 'indexedDB'];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function originOf(url) {
  try { return new URL(url).origin; } catch { return url; }
}
function matchesAllowed(url, allowed) {
  const origin = originOf(url);
  return allowed.some(a => origin === a || url.startsWith(a));
}

// ─── Extractor ───────────────────────────────────────────────────────────────
function analyse(html, filename) {
  const issues = [];
  const notes  = [];

  // Script src
  const scriptSrcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
  for (const src of scriptSrcs) {
    if (src.startsWith('http')) {
      if (!matchesAllowed(src, ALLOWED_SCRIPT_ORIGINS)) {
        issues.push({ severity: 'BLOCK', directive: 'script-src', value: src, reason: 'Origin not in allowlist' });
      } else {
        notes.push({ severity: 'OK', directive: 'script-src', value: src });
      }
    }
  }

  // Link/style href (stylesheets)
  const linkHrefs = [...html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/gi)].map(m => m[1]);
  const linkHrefs2 = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)].map(m => m[1]);
  for (const href of [...new Set([...linkHrefs, ...linkHrefs2])]) {
    if (href.startsWith('http')) {
      if (!matchesAllowed(href, ALLOWED_STYLE_ORIGINS)) {
        issues.push({ severity: 'BLOCK', directive: 'style-src', value: href, reason: 'Origin not in allowlist' });
      } else {
        notes.push({ severity: 'OK', directive: 'style-src', value: href });
      }
    }
  }

  // ESM import URLs (type="module" script blocks)
  const esmImports = [...html.matchAll(/import\s+[^'"]*['"](\bhttps?:\/\/[^'"]+)['"]/g)].map(m => m[1]);
  for (const src of esmImports) {
    if (!matchesAllowed(src, ALLOWED_SCRIPT_ORIGINS)) {
      issues.push({ severity: 'BLOCK', directive: 'script-src (ESM)', value: src, reason: 'Origin not in allowlist' });
    } else {
      notes.push({ severity: 'OK', directive: 'script-src (ESM)', value: src });
    }
  }

  // connect-src 'none': fetch / XMLHttpRequest / WebSocket
  if (/\bfetch\s*\(/.test(html))
    issues.push({ severity: 'BLOCK', directive: 'connect-src', value: 'fetch()', reason: "connect-src 'none'" });
  if (/new\s+XMLHttpRequest/.test(html))
    issues.push({ severity: 'BLOCK', directive: 'connect-src', value: 'XMLHttpRequest', reason: "connect-src 'none'" });
  if (/new\s+WebSocket/.test(html))
    issues.push({ severity: 'BLOCK', directive: 'connect-src', value: 'WebSocket', reason: "connect-src 'none'" });
  if (/\baxios\b/.test(html) && scriptSrcs.some(s => s.includes('axios')))
    issues.push({ severity: 'BLOCK', directive: 'connect-src', value: 'axios HTTP', reason: "connect-src 'none'" });

  // frame-src 'none': nested <iframe>
  if (/<iframe/i.test(html))
    issues.push({ severity: 'BLOCK', directive: 'frame-src', value: '<iframe>', reason: "frame-src 'none'" });

  // form-action 'none': <form action="...">
  const formActions = [...html.matchAll(/<form[^>]+action=["']([^"']+)["']/gi)].map(m => m[1]);
  for (const action of formActions) {
    if (action && action !== '#') {
      issues.push({ severity: 'BLOCK', directive: 'form-action', value: action, reason: "form-action 'none'" });
    }
  }

  // Sandbox blocks (not CSP, but iframe sandbox restriction)
  for (const api of SANDBOX_BLOCKS) {
    if (html.includes(api)) {
      issues.push({ severity: 'SANDBOX', directive: 'sandbox', value: api, reason: 'Blocked: no allow-same-origin' });
    }
  }

  return { issues, notes };
}

// ─── Main ────────────────────────────────────────────────────────────────────
const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.html')).sort();

let totalPass = 0, totalWarn = 0, totalFail = 0;

console.log('\n╔══════════════════════════════════════════════════════════════════╗');
console.log('║         html-docs — CSP Static Analysis Report                  ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

for (const file of files) {
  const html = readFileSync(join(FIXTURES_DIR, file), 'utf8');
  const { issues, notes } = analyse(html, file);

  const blocks   = issues.filter(i => i.severity === 'BLOCK');
  const sandboxed = issues.filter(i => i.severity === 'SANDBOX');
  const status = blocks.length > 0 ? '❌ FAIL' : sandboxed.length > 0 ? '⚠️  WARN' : '✅ PASS';

  if (blocks.length > 0) totalFail++;
  else if (sandboxed.length > 0) totalWarn++;
  else totalPass++;

  console.log(`${status}  ${file}`);

  for (const n of notes)
    console.log(`       ✓ [${n.directive}] ${n.value}`);

  for (const issue of issues) {
    const prefix = issue.severity === 'SANDBOX' ? '  ⚠️ ' : '  🚫';
    console.log(`${prefix} [${issue.directive}] ${issue.value}  →  ${issue.reason}`);
  }
  if (issues.length === 0 && notes.length === 0)
    console.log('       (no external resources)');
  console.log();
}

console.log('─────────────────────────────────────────────────────────────────');
console.log(`  Fixtures: ${files.length}   ✅ Pass: ${totalPass}   ⚠️  Warn: ${totalWarn}   ❌ Fail: ${totalFail}`);
console.log('─────────────────────────────────────────────────────────────────\n');
