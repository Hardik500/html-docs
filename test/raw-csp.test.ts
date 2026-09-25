import { describe, expect, it } from "vitest";
import { RAW_CSP, rawBinaryResponseHeaders, rawResponseHeaders } from "~/lib/csp.server";

describe("raw content response policy", () => {
  it("sandboxes direct raw documents without same-origin access", () => {
    expect(RAW_CSP).toContain("sandbox allow-scripts");
    expect(RAW_CSP).not.toContain("allow-same-origin");
    expect((rawResponseHeaders() as Record<string, string>)["Content-Security-Policy"]).toBe(RAW_CSP);
  });

  it("adds isolation headers to raw PDF responses", () => {
    expect(rawBinaryResponseHeaders()).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    });
  });
});
