import { describe, it, expect } from "vitest";
import { htmlToMarkdown } from "~/lib/htmlToMarkdown.server";

describe("htmlToMarkdown", () => {
  it("converts heading", () => expect(htmlToMarkdown("<h1>Hello</h1>")).toBe("# Hello"));
  it("strips <head>", () => {
    const full = "<!DOCTYPE html><html><head><style>*{}</style></head><body><p>Hi</p></body></html>";
    expect(htmlToMarkdown(full)).toBe("Hi");
  });
  it("handles empty string", () => expect(htmlToMarkdown("")).toBe(""));
});
