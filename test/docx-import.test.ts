import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sample.docx");

describe("mammoth docx conversion", () => {
  it("converts headings and bold text to semantic HTML", async () => {
    const buffer = readFileSync(fixture);
    const { value, messages } = await mammoth.convertToHtml({ buffer });
    expect(messages.filter((m) => m.type === "error")).toHaveLength(0);
    expect(value).toContain("<h1>Quarterly Report</h1>");
    expect(value).toContain("<h2>Section</h2>");
    expect(value).toMatch(/<strong>bold text<\/strong>/);
  });
});
