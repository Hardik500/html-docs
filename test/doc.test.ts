import { describe, it, expect } from "vitest";
import { docToHtml } from "~/lib/doc";

describe("docToHtml", () => {
  it("wraps a fragment in a full HTML document with prose styles", () => {
    const out = docToHtml("<h1>Report</h1><p>Hello</p>");
    expect(out).toContain("<!DOCTYPE html>");
    expect(out).toMatch(/<head>[\s\S]*<style>/);
    expect(out).toContain("<h1>Report</h1><p>Hello</p>");
    // body is wrapped exactly once
    expect(out.match(/<body>/g)).toHaveLength(1);
  });

  it("preserves inline base64 images", () => {
    const img = '<img src="data:image/png;base64,iVBORw0KGgo=" />';
    expect(docToHtml(img)).toContain(img);
  });
});
