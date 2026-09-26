import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RAW_CSP } from "~/lib/csp.server";
// Plain JS module shared with the analyser script; typed by csp-policy.d.mts.
import {
  classifyFixture,
  dedupeFindings,
  directiveAllows,
  extractNetworkUrls,
  hostSourceAllows,
  parseCsp,
  readFixtureExpectation,
  EXPECT_ALLOWED,
  EXPECT_BLOCKED,
} from "./csp-policy.mjs";

const FIXTURES_DIR = join(import.meta.dirname, "csp-fixtures");

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

// ─── Fixture expectations and the gate's verdict ──────────────────────────────
//
// `node test/csp-check.mjs` used to treat every blocked finding as a failure, so
// it exited 1 on a clean tree and was therefore useless as a gate. Fixtures now
// declare an expectation and the verdict is checked in both directions.

describe("readFixtureExpectation", () => {
  it("defaults to allowed when no marker is present", () => {
    expect(readFixtureExpectation("<html><body>hi</body></html>")).toBe(EXPECT_ALLOWED);
  });

  it("reads both declared values, case-insensitively", () => {
    expect(readFixtureExpectation("<!-- csp-expect: blocked -->")).toBe(EXPECT_BLOCKED);
    expect(readFixtureExpectation("<!-- CSP-EXPECT: ALLOWED -->")).toBe(EXPECT_ALLOWED);
  });

  it("tolerates an explanation after the value", () => {
    expect(
      readFixtureExpectation("<!-- csp-expect: blocked — this must be denied -->"),
    ).toBe(EXPECT_BLOCKED);
  });

  it("throws on a typo rather than silently downgrading to allowed", () => {
    // A silent downgrade would turn a negative fixture into a positive one.
    expect(() => readFixtureExpectation("<!-- csp-expect: blockedish -->")).toThrow(
      /Unrecognised csp-expect value "blockedish"/,
    );
  });

  it("throws when the marker has no value", () => {
    expect(() => readFixtureExpectation("<!-- csp-expect: -->")).toThrow(
      /Unrecognised csp-expect value \(missing\)/,
    );
  });
});

describe("dedupeFindings", () => {
  it("collapses the same directive+url reported more than once", () => {
    const finding = { directive: "connect-src", url: "https://x.test/a", reason: "no" };
    expect(dedupeFindings([finding, { ...finding }, { ...finding, url: "https://x.test/b" }])).toHaveLength(2);
  });
});

describe("classifyFixture", () => {
  const blockedOne = (n = 1) =>
    Array.from({ length: n }, (_, i) => ({ directive: "script-src", url: `https://x.test/${i}.js`, reason: "not listed" }));
  const allowedOne = [{ directive: "script-src", url: "https://cdn.test/a.js", reason: "allowed" }];

  it("passes a positive fixture that has nothing blocked", () => {
    expect(classifyFixture(EXPECT_ALLOWED, { blocked: [], allowed: allowedOne }).status).toBe("pass");
  });

  it("fails a positive fixture once something it uses is blocked", () => {
    const result = classifyFixture(EXPECT_ALLOWED, { blocked: blockedOne(), allowed: allowedOne });
    expect(result.status).toBe("fail");
    expect(result.problems[0]).toMatch(/expects to work are blocked/);
  });

  it("passes a negative fixture when everything it reaches for is blocked", () => {
    expect(classifyFixture(EXPECT_BLOCKED, { blocked: blockedOne(3), allowed: [] }).status).toBe("pass");
  });

  it("fails a negative fixture when the policy allows something it must deny", () => {
    // This is the bypass regression: the fixture is a security assertion, so a
    // newly-allowed URL is a failure, not a pass.
    const result = classifyFixture(EXPECT_BLOCKED, { blocked: blockedOne(2), allowed: allowedOne });
    expect(result.status).toBe("fail");
    expect(result.problems[0]).toMatch(/must be blocked but the policy allows them/);
  });

  it("fails a negative fixture that no longer exercises the policy", () => {
    // Guards against a fixture silently decaying into a no-op.
    const result = classifyFixture(EXPECT_BLOCKED, { blocked: [], allowed: allowedOne });
    expect(result.status).toBe("fail");
    expect(result.problems.join(" ")).toMatch(/no longer exercises the policy/);
  });

  it("warns, but does not fail, when only a sandbox restriction applies", () => {
    const result = classifyFixture(EXPECT_ALLOWED, {
      blocked: [], allowed: [], sandboxed: [{ api: "window.open", reason: "no allow-popups" }],
    });
    expect(result.status).toBe("warn");
  });
});

describe("the shipped fixture set", () => {
  const fixtures = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".html")).sort();

  it("has fixtures at all", () => {
    expect(fixtures.length).toBeGreaterThan(10);
  });

  it("gives every fixture a marker the gate understands", () => {
    for (const file of fixtures) {
      const html = readFileSync(join(FIXTURES_DIR, file), "utf8");
      expect(
        () => readFixtureExpectation(html),
        `${file} has an unreadable csp-expect marker`,
      ).not.toThrow();
    }
  });

  it("keeps the lookalike-host bypass fixture as a negative assertion", () => {
    // Commit b56beaa fixed a prefix-matching bypass. This is the regression guard
    // for it, so it must stay marked as expecting denial.
    const html = readFileSync(join(FIXTURES_DIR, "26-lookalike-host.html"), "utf8");
    expect(readFixtureExpectation(html)).toBe(EXPECT_BLOCKED);
    expect(html).toContain("cdnjs.cloudflare.com.evil.test");
  });

  it("covers both directions: positive and negative fixtures exist", () => {
    const expectations = fixtures.map((file) =>
      readFixtureExpectation(readFileSync(join(FIXTURES_DIR, file), "utf8")),
    );
    expect(expectations.filter((e) => e === EXPECT_BLOCKED).length).toBeGreaterThanOrEqual(5);
    expect(expectations.filter((e) => e === EXPECT_ALLOWED).length).toBeGreaterThanOrEqual(15);
  });
});
