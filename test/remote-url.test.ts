import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { normalizeRemoteUrl } = require("../electron/remote-url.cjs") as {
  normalizeRemoteUrl: (
    value: string,
    options?: { allowHttpLoopback?: boolean },
  ) => string;
};

describe("desktop remote URL validation", () => {
  it("normalizes HTTPS origins", () => {
    expect(normalizeRemoteUrl("https://example.test/")).toBe("https://example.test");
    expect(normalizeRemoteUrl("HTTPS://example.test/")).toBe("https://example.test");
  });

  it("rejects non-HTTPS hosted origins", () => {
    expect(() => normalizeRemoteUrl("http://evil.example")).toThrow(
      "must use HTTPS",
    );
    expect(() => normalizeRemoteUrl("ftp://example.test")).toThrow(
      "must use HTTPS",
    );
  });

  it("allows loopback HTTP only when explicitly enabled", () => {
    expect(
      normalizeRemoteUrl("http://127.0.0.1:3000/", {
        allowHttpLoopback: true,
      }),
    ).toBe("http://127.0.0.1:3000");
    expect(() =>
      normalizeRemoteUrl("http://127.0.0.1:3000/", {
        allowHttpLoopback: false,
      }),
    ).toThrow("must use HTTPS");
  });

  it("rejects credentials and non-origin URLs", () => {
    expect(() => normalizeRemoteUrl("https://user:pass@example.test")).toThrow(
      "must not contain credentials",
    );
    expect(() => normalizeRemoteUrl("https://example.test/app")).toThrow(
      "only an origin",
    );
    expect(() => normalizeRemoteUrl("https://example.test?token=secret")).toThrow(
      "only an origin",
    );
  });
});
