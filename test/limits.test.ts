import { describe, it, expect } from "vitest";
import { MAX_HTML_BYTES, MAX_PDF_BYTES, MAX_DOC_BYTES, maxBytesForType } from "~/lib/limits";

describe("maxBytesForType", () => {
  it("gives html and markdown the 500 KB limit", () => {
    expect(maxBytesForType("html")).toBe(MAX_HTML_BYTES);
    expect(maxBytesForType("markdown")).toBe(MAX_HTML_BYTES);
    expect(MAX_HTML_BYTES).toBe(500_000);
  });

  it("gives pdf and doc the 2.8 MB limit", () => {
    expect(maxBytesForType("pdf")).toBe(MAX_PDF_BYTES);
    expect(maxBytesForType("doc")).toBe(MAX_DOC_BYTES);
    expect(MAX_DOC_BYTES).toBe(2_800_000);
  });
});
