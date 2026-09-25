import { describe, expect, it } from "vitest";
import { RAW_CSP } from "~/lib/csp.server";
// @ts-expect-error - plain JS module shared with the analyser script
import { directiveAllows, extractNetworkUrls, hostSourceAllows, parseCsp } from "./csp-policy.mjs";

const policy = parseCsp(RAW_CSP);
const scriptSrc = policy.get("script-src");
const connectSrc = policy.get("connect-src");
const styleSrc = policy.get("style-src");
const frameSrc = policy.get("frame-src");
const imgSrc = policy.get("img-src");
const formAction = policy.get("form-action");

describe("CSP host-source matching", () => {
  it("allows the exact host", () => {
    expect(hostSourceAllows("https://cdnjs.cloudflare.com", "https://cdnjs.cloudflare.com/x.js")).toBe(true);
  });

  it("rejects a lookalike host that merely starts with an allowed host", () => {
    // The bug this replaces: a startsWith() check let these through.
    expect(hostSourceAllows("https://cdnjs.cloudflare.com", "https://cdnjs.cloudflare.com.evil.test/x.js")).toBe(false);
    expect(hostSourceAllows("https://unpkg.com", "https://unpkg.com.evil.test/x.js")).toBe(false);
    expect(hostSourceAllows("https://cdn.jsdelivr.net", "https://cdn.jsdelivr.net.attacker.io/npm")).toBe(false);
  });

  it("rejects a downgraded scheme on the same host", () => {
    expect(hostSourceAllows("https://unpkg.com", "http://unpkg.com/x.js")).toBe(false);
  });

  it("matches any port when the source does not pin one", () => {
    // CSP Level 3: a host-source without an explicit port allows any port.
    expect(hostSourceAllows("https://unpkg.com", "https://unpkg.com:8443/x.js")).toBe(true);
    expect(hostSourceAllows("https://unpkg.com:443", "https://unpkg.com:8443/x.js")).toBe(false);
    expect(hostSourceAllows("https://unpkg.com:443", "https://unpkg.com/x.js")).toBe(true);
  });

  it("allows explicit subdomains only for a dotted source", () => {
    expect(hostSourceAllows("https://unpkg.com", "https://a.unpkg.com/x.js")).toBe(false);
    expect(hostSourceAllows("https://.unpkg.com", "https://a.unpkg.com/x.js")).toBe(true);
    expect(hostSourceAllows("https://.unpkg.com", "https://unpkg.com/x.js")).toBe(true);
  });

  it("honours a path prefix only on a segment boundary", () => {
    expect(hostSourceAllows("https://cdn.example.com/assets/", "https://cdn.example.com/assets/app.js")).toBe(true);
    expect(hostSourceAllows("https://cdn.example.com/assets/", "https://cdn.example.com/assetsx/app.js")).toBe(false);
  });
});

describe("CSP directive evaluation against the real RAW_CSP", () => {
  it("parses the policy the server actually sends", () => {
    expect(scriptSrc).toContain("https://cdnjs.cloudflare.com");
    expect(connectSrc).toContain("https://cdnjs.cloudflare.com");
    // The old analyser modelled connect-src as 'none'; it is not.
    expect(connectSrc).not.toEqual(["'none'"]);
    expect(frameSrc).toEqual(["'none'"]);
    expect(formAction).toEqual(["'none'"]);
  });

  it("allows the CDNs the policy lists", () => {
    expect(directiveAllows("script-src", scriptSrc, "https://unpkg.com/vue@3/dist/vue.global.js").allowed).toBe(true);
    expect(directiveAllows("style-src", styleSrc, "https://fonts.googleapis.com/css2?family=Inter").allowed).toBe(true);
  });

  it("blocks hosts outside the allowlist", () => {
    const verdict = directiveAllows("script-src", scriptSrc, "https://evil.test/x.js");
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("not listed in script-src");
  });

  it("blocks a lookalike host in a real directive", () => {
    expect(directiveAllows("script-src", scriptSrc, "https://cdnjs.cloudflare.com.evil.test/x.js").allowed).toBe(false);
    expect(directiveAllows("connect-src", connectSrc, "https://unpkg.com.evil.test/data").allowed).toBe(false);
  });

  it("allows fetch to a listed connect-src origin", () => {
    // Directly contradicts the previous "connect-src 'none'" assumption.
    expect(directiveAllows("connect-src", connectSrc, "https://cdnjs.cloudflare.com/api").allowed).toBe(true);
  });

  it("blocks fetch to an unlisted origin", () => {
    expect(directiveAllows("connect-src", connectSrc, "https://jsonplaceholder.typicode.com/todos/1").allowed).toBe(false);
  });

  it("blocks a websocket to a listed https origin because the scheme differs", () => {
    // connect-src lists https:, not wss:, so a wss:// URL is still blocked.
    expect(directiveAllows("connect-src", connectSrc, "wss://echo.websocket.org").allowed).toBe(false);
  });

  it("blocks iframes and form posts", () => {
    expect(directiveAllows("frame-src", frameSrc, "https://example.com/embed").allowed).toBe(false);
    expect(directiveAllows("form-action", formAction, "https://example.com/submit").allowed).toBe(false);
  });

  it("allows any https image and data: images", () => {
    expect(directiveAllows("img-src", imgSrc, "https://images.example.com/a.png").allowed).toBe(true);
    expect(directiveAllows("img-src", imgSrc, "data:image/png;base64,AAAA").allowed).toBe(true);
  });
});

describe("network URL extraction", () => {
  it("finds the target of each network API", () => {
    const html = `
      fetch('https://a.test/one');
      const ws = new WebSocket('wss://b.test/socket');
      const x = new XMLHttpRequest(); x.open('GET', 'https://c.test/two');
      axios.get('https://d.test/three');
    `;
    expect(extractNetworkUrls(html).map((e: { url: string }) => e.url).sort()).toEqual([
      "https://a.test/one",
      "https://c.test/two",
      "https://d.test/three",
      "wss://b.test/socket",
    ]);
  });

  it("ignores relative and non-network literals", () => {
    expect(extractNetworkUrls("fetch('/local'); fetch('not a url');")).toEqual([]);
  });
});
