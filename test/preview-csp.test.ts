import { describe, expect, it } from "vitest";
import { injectPreviewCsp, PREVIEW_CSP } from "~/lib/preview-csp";

describe("preview CSP", () => {
  it("injects the shared policy into dashboard and editor previews", () => {
    const html = injectPreviewCsp("<!doctype html><html><head></head><body>Preview</body></html>");
    expect(html).toContain(PREVIEW_CSP);
    expect(html).toContain("<body>Preview</body>");
  });
});
