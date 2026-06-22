import TurndownService from "turndown";

const td = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

// Drop non-content nodes — prevents inline CSS/JS from leaking into Markdown output
// when converting full HTML documents produced by markdownToHtml() or docToHtml().
td.remove(["style", "script", "head"]);

/** Converts an HTML string (fragment or full document) to Markdown. */
export function htmlToMarkdown(html: string): string {
  return td.turndown(html);
}
