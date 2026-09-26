import { describe, expect, it } from "vitest";
import { looksLikeGoogleHtml, normalizeGoogleHtml } from "~/lib/googleDocs";
import { htmlToMarkdown } from "~/lib/htmlToMarkdown.server";
import { extractTitle } from "~/lib/titleExtract";
import {
  GDOCS_CLIPBOARD,
  GDOCS_WEBPAGE_EXPORT,
  gdocsHtml,
} from "./helpers/gdocs-fixtures.mjs";

describe("looksLikeGoogleHtml", () => {
  it("recognizes Google Docs clipboard and Webpage export markup", () => {
    expect(looksLikeGoogleHtml(GDOCS_CLIPBOARD)).toBe(true);
    expect(looksLikeGoogleHtml(GDOCS_WEBPAGE_EXPORT)).toBe(true);
    expect(looksLikeGoogleHtml(gdocsHtml({ paragraphs: 2 }))).toBe(true);
  });

  it("leaves ordinary content alone", () => {
    expect(looksLikeGoogleHtml("<p>plain <strong>html</strong></p>")).toBe(false);
    expect(looksLikeGoogleHtml("# A markdown tab")).toBe(false);
    expect(looksLikeGoogleHtml("<!DOCTYPE html><html><head><title>T</title></head><body>x</body></html>")).toBe(false);
    expect(looksLikeGoogleHtml("")).toBe(false);
  });
});

describe("normalizeGoogleHtml — Google Docs clipboard fragment", () => {
  const result = normalizeGoogleHtml(GDOCS_CLIPBOARD);

  it("removes the docs-internal-guid wrapper instead of treating it as bold", () => {
    expect(result.html).not.toContain("docs-internal-guid");
    expect(result.html).not.toContain("<b");
    expect(result.html).not.toContain("</b>");
    // The wrapper used to span the whole document, so its removal means the
    // content now starts at the first real block element.
    expect(result.html.startsWith("<p>")).toBe(true);
  });

  it("promotes inline run styling to semantic tags", () => {
    expect(result.html).toContain("<strong>bold</strong>");
    expect(result.html).toContain("<em> italic</em>");
    expect(result.html).toContain("Plain ");
  });

  it("drops the presentational CSS that blows up the size limit", () => {
    expect(result.html).not.toContain("font-family");
    expect(result.html).not.toContain("white-space");
    expect(result.html).not.toContain("background-color");
    expect(result.html).not.toContain("line-height");
    expect(result.html).not.toContain("dir=");
    expect(result.html).not.toContain("<meta");
  });

  it("keeps the document's semantic structure", () => {
    expect(result.html).toContain("<h1><span>Heading</span></h1>");
    expect(result.html).toContain("<ul><li><p><span>bullet one</span></p></li></ul>");
    expect(result.html).toContain("<table>");
    expect(result.html).toContain("<td><p>cell</p></td>");
  });

  it("leaves unformatted runs as plain spans rather than inventing emphasis", () => {
    // font-weight:400 is the Google default and must not read as bold.
    expect(result.html).toContain("<span>Plain </span>");
    expect(result.html).not.toContain("<strong>Plain </strong>");
  });

  it("produces a balanced document", () => {
    const stack: string[] = [];
    for (const [, closing, name] of result.html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/g)) {
      if (closing) expect(stack.pop()).toBe(name.toLowerCase());
      else stack.push(name.toLowerCase());
    }
    expect(stack).toEqual([]);
    expect((result.html.match(/<strong>/g) ?? []).length).toBe(
      (result.html.match(/<\/strong>/g) ?? []).length,
    );
  });

  it("shrinks the payload substantially", () => {
    expect(result.html.length).toBeLessThan(GDOCS_CLIPBOARD.length * 0.5);
  });
});

describe("normalizeGoogleHtml — Google Docs Webpage export", () => {
  const result = normalizeGoogleHtml(GDOCS_WEBPAGE_EXPORT);

  it("recovers the document title", () => {
    expect(result.title).toBe("Q3 Planning Doc");
  });

  it("keeps a full document a full document (it renders fine on its own)", () => {
    expect(result.html).toContain("<html");
    expect(result.html).toContain("<body");
  });

  it("strips the export's generated font link and meta tags", () => {
    expect(result.html).not.toContain("fonts.googleapis.com");
    expect(result.html).not.toContain("<meta");
  });

  it("keeps a hand-written stylesheet link", () => {
    const authored =
      '<!DOCTYPE html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com">' +
      '<link rel="stylesheet" href="/my.css"></head><body><p>mine</p></body></html>';
    // Detection keys off the Google font host, so this is treated as Google and
    // only the Google link goes; a non-Google link is never touched.
    expect(normalizeGoogleHtml(authored).html).not.toContain("https://fonts.googleapis.com");
    expect(normalizeGoogleHtml(authored).html).toContain("/my.css");
  });

  it("still exposes the visible text", () => {
    expect(result.html).toContain("Plain ");
    expect(result.html).toContain("<strong>bold</strong>");
    expect(result.html).toContain("<h1><span>Heading</span></h1>");
  });
});

describe("normalizeGoogleHtml — Google Sheets", () => {
  it("normalizes Sheets HTML carrying the google-sheets-html-origin marker", () => {
    const sheets =
      '<div google-sheets-html-origin=""><table><tbody><tr>' +
      '<td style="font-family:Arial;font-size:10pt;vertical-align:top;">A1</td></tr></tbody></table></div>';
    const result = normalizeGoogleHtml(sheets);
    expect(result.changed).toBe(true);
    expect(result.html).toContain("A1");
    expect(result.html).not.toContain("font-family");
    // Sheets content is mostly tabular, so the table structure must survive.
    expect(result.html).toContain("<td>A1</td>");
  });
});

describe("normalizeGoogleHtml — is a no-op for non-Google content", () => {
  it("returns hand-written HTML byte-identical", () => {
    const html =
      '<!DOCTYPE html><html><head><title>My Doc</title><style>b{}</style></head><body><h1>Hi</h1></body></html>';
    const result = normalizeGoogleHtml(html);
    expect(result.changed).toBe(false);
    expect(result.html).toBe(html);
  });

  it("preserves hand-authored inline styles on non-Google markup", () => {
    const html = '<p style="color:red;font-size:20px">Carefully styled</p>';
    expect(normalizeGoogleHtml(html).html).toBe(html);
  });
});

describe("Google Docs content survives the Markdown export", () => {
  it("does not wrap the file in unbalanced bold markers", () => {
    const md = htmlToMarkdown(normalizeGoogleHtml(GDOCS_CLIPBOARD).html);
    expect(md.startsWith("**")).toBe(false);
    expect(md.endsWith("**")).toBe(false);
    expect(md).toContain("**bold**");
    expect(md).toContain("_italic_");
  });
});

describe("title extraction from normalized Google Docs content", () => {
  it("finds the h1 title of a normalized clipboard fragment", () => {
    expect(extractTitle(normalizeGoogleHtml(GDOCS_CLIPBOARD).html, "Untitled")).toBe("Heading");
  });

  it("exposes the Webpage export title so the caller can name the document", () => {
    expect(normalizeGoogleHtml(GDOCS_WEBPAGE_EXPORT).title).toBe("Q3 Planning Doc");
  });
});

describe("payload size after normalization", () => {
  it("brings a realistic large Google Doc back under the html/markdown tab limit", () => {
    // 300 paragraphs x 3 formatting runs is >500 KB of raw Google markup, which
    // exceeds MAX_HTML_BYTES (500_000) and was rejected with an opaque 413.
    const raw = gdocsHtml({ paragraphs: 300, wordsPerParagraph: 120, runsPerParagraph: 3 });
    expect(Buffer.byteLength(raw, "utf8")).toBeGreaterThan(500_000);

    const normalized = normalizeGoogleHtml(raw);
    expect(Buffer.byteLength(normalized.html, "utf8")).toBeLessThan(500_000);
  });
});
