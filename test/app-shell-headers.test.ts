import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { APP_CSP, RAW_CSP } from "~/lib/csp.server";
import { parseCsp, directiveAllows } from "./csp-policy.mjs";

const REPO = join(import.meta.dirname, "..");
const APP_SOURCES = [
  "app/root.tsx",
  "app/routes/d.$docId.$tabSlug.tsx",
  "app/routes/d.$docId.edit.tsx",
  "app/routes/dashboard.tsx",
  "app/routes/_index.tsx",
  "app/components/PreviewIframe.tsx",
];

const read = (relative: string) => readFileSync(join(REPO, relative), "utf8");

/** Strips comments so prose about a tag is not mistaken for using it. */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * `app/root.tsx` used to return a `Response` carrying the app-shell headers from
 * its loader. React Router only honours loader response headers for resource
 * routes, so a returned Response from a *UI* loader has its headers discarded
 * silently and the whole policy was never sent. This asserts the headers are now
 * applied through the mechanism React Router actually uses.
 */
describe("app-shell security headers are actually delivered", () => {
  const root = read("app/root.tsx");

  it("declares a `headers` export on the root route", () => {
    expect(root).toMatch(/export const headers:\s*Route\.HeadersFunction/);
  });

  it("sets every documented header, and does not do it by returning a Response from the loader", () => {
    expect(root).toContain('headers.set("Content-Security-Policy"');
    expect(root).toContain('headers.set("X-Frame-Options", "DENY")');
    expect(root).toContain('headers.set("X-Content-Type-Options", "nosniff")');
    expect(root).toContain('headers.set("Referrer-Policy"');
    expect(root).toContain('headers.set("Permissions-Policy"');
    expect(root).toContain('headers.set("Strict-Transport-Security"');

    // The loader must not return a bare Response: that is the exact mistake
    // that dropped these headers.
    expect(root).not.toMatch(/return new Response\(null, \{ headers: responseHeaders \}\)/);
  });

  it("forwards the loader's Set-Cookie values so a session refresh still lands", () => {
    // A session refresh writes new cookies via the Supabase cookie setAll
    // handler. If the `headers` export does not start from loaderHeaders they are
    // dropped and a refreshing user silently stays signed out.
    expect(root).toMatch(/new Headers\(loaderHeaders\)/);
    expect(root).toMatch(/return data\(null, \{ headers: responseHeaders \}\)/);
  });

  it("sends HSTS in production only, so a plaintext local origin is not pinned", () => {
    expect(root).toMatch(
      /if \(process\.env\.NODE_ENV === "production"\) \{[\s\S]*?Strict-Transport-Security/,
    );
  });

  it("is not overridden by any other route", () => {
    // A route's `headers` export takes precedence over its parents'. If a child
    // route declared one, the root policy would stop applying to that page.
    const offenders = readdirSync(join(REPO, "app/routes"))
      .filter((file) => file.endsWith(".tsx") || file.endsWith(".ts"))
      .filter((file) => /export const headers\b|export function headers\b/.test(read(`app/routes/${file}`)));
    expect(offenders).toEqual([]);
  });
});

/**
 * `APP_CSP` sets `object-src 'none'`, which makes `<embed>` and `<object>`
 * unusable in the app shell. Both PDF previews used `<embed>`, so they rendered
 * nothing once the header started being delivered. This locks in the
 * relationship between the policy and the markup that has to coexist with it.
 */
describe("app-shell markup is compatible with the app-shell CSP", () => {
  const policy = parseCsp(APP_CSP);

  it("declares object-src 'none', which is what forces the iframe approach", () => {
    const verdict = directiveAllows("object-src", policy.get("object-src"), "data:application/pdf;base64,AAAA");
    expect(verdict.allowed).toBe(false);
  });

  it("never uses <embed> or <object> in a shell surface", () => {
    const offenders = APP_SOURCES.filter((file) => /<(embed|object)\b/.test(stripComments(read(file))));
    expect(offenders).toEqual([]);
  });

  it("previews PDFs from the same-origin /raw URL, which frame-src permits", () => {
    const rawFrame = directiveAllows("frame-src", policy.get("frame-src"), "https://app.example/raw/doc/tab");
    expect(rawFrame.allowed).toBe(true);

    const editor = read("app/components/PreviewIframe.tsx");
    expect(editor).toMatch(/function PdfPreview/);
    expect(editor).toContain("<iframe");
    // The data: URL it used to build is gone.
    expect(editor).not.toContain("data:application/pdf");
  });

  it("passes a same-origin PDF src from the editor and the public viewer", () => {
    expect(read("app/routes/d.$docId.edit.tsx")).toMatch(
      /src=\{activeTab \? `\/raw\/\$\{doc\.id\}\/\$\{activeTab\.slug\}` : undefined\}/,
    );
    expect(read("app/routes/d.$docId.$tabSlug.tsx")).toMatch(
      /<iframe[\s\S]{0,200}src=\{`\/raw\/\$\{doc\.id\}\/\$\{activeTab\.slug\}`\}/,
    );
  });

  it("allows the self-hosted Monaco assets and its blob workers", () => {
    // Monaco is served from our own origin and runs its language workers from
    // blob: URLs; both must stay permitted or the editor never mounts.
    expect(directiveAllows("script-src", policy.get("script-src"), "https://app.example/monaco/vs/loader.js").allowed).toBe(true);
    expect(directiveAllows("script-src", policy.get("script-src"), "blob:https://app.example/abc").allowed).toBe(true);
    expect(directiveAllows("worker-src", policy.get("worker-src"), "blob:https://app.example/abc").allowed).toBe(true);
    // And the CDN it used to load from must not be needed any more.
    expect(APP_CSP).not.toContain("cdn.jsdelivr.net");
  });

  it("still allows the font origins the shell links to", () => {
    expect(directiveAllows("style-src", policy.get("style-src"), "https://fonts.googleapis.com/css2?family=Inter").allowed).toBe(true);
    expect(directiveAllows("font-src", policy.get("font-src"), "https://fonts.gstatic.com/s/inter/v20/x.woff2").allowed).toBe(true);
  });

  it("leaves the /raw policy isolated from the app shell", () => {
    // Two different policies for two different trust levels; they must not be
    // conflated, since the app shell is privileged and /raw is sandboxed.
    expect(RAW_CSP).not.toBe(APP_CSP);
    expect(RAW_CSP).toContain("sandbox allow-scripts");
    expect(APP_CSP).toContain("frame-ancestors 'none'");
  });
});
