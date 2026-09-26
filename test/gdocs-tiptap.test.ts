/**
 * How html-docs handles "Google Docs format" content, part 2.
 *
 * (b)/(c): what TipTap StarterKit does to the `docs-internal-guid` wrapper, the
 * per-span inline styles and the surrounding document, measured with the REAL
 * DocEditor extension set (app/components/DocEditor.tsx:185) inside a real
 * Chromium, plus how a real browser parses docToHtml() output for a doc tab.
 *
 * @tiptap/core needs a DOM and this repo has no jsdom/happy-dom, so the work is
 * done in the headless Chromium from the Playwright cache; see the helper.
 * Set CHROME_PATH to override the binary.
 *
 * The whole file SKIPS when no browser is available. @tiptap/core cannot be
 * exercised without a real DOM, and a missing browser is an environment fact —
 * a fresh clone, or a CI runner that has not installed one — not a failure of
 * the behaviour under test. Without this the suite went red on its first CI run
 * for a reason that had nothing to do with the code.
 */
import { describe, expect, it } from "vitest";
import { findChrome, runInBrowser } from "./helpers/gdocs-browser-run.mjs";
import {
  GDOCS_CLIPBOARD,
  GDOCS_WEBPAGE_EXPORT,
  GDOCS_SHEETS_MARKER,
} from "./helpers/gdocs-fixtures.mjs";

const BROWSER = findChrome();

const GDOCS_MARKS =
  '<b style="font-weight:normal;" id="docs-internal-guid-deadbeef-0000-1111-222233334444">' +
  '<p dir="ltr"><span style="font-weight:700;">B</span><span style="font-style:italic;">I</span>' +
  '<span style="text-decoration:underline;">U</span><span style="vertical-align:super;">sup</span>' +
  '<a href="https://example.com/x" style="color:#1155cc;">link</a></p></b>';

const GDOCS_PREWRAP =
  '<b style="font-weight:normal;" id="docs-internal-guid-prewrap"><p dir="ltr">' +
  '<span style="white-space:pre;white-space:pre-wrap;">alpha    beta</span>' +
  '<span style="white-space:pre;white-space:pre-wrap;">   gamma</span></p></b>';

const GDOCS_SHEETS =
  `<div ${GDOCS_SHEETS_MARKER}=""><style type="text/css">.ss{border:1px solid #000;}</style>` +
  '<table border="1" style="border-collapse:collapse"><tbody>' +
  '<tr><td class="ss" style="padding:2px"><span style="font-family:Arial;font-size:10pt">A1</span></td>' +
  '<td class="ss" style="padding:2px"><span style="font-family:Arial;font-size:10pt">B1</span></td></tr>' +
  "</tbody></table></div>";

// Resolved only when a browser exists, so merely importing this file never needs
// one and the suites below can skip cleanly.
const results = BROWSER
  ? runInBrowser([
      { kind: "tiptap", name: "clipboard", html: GDOCS_CLIPBOARD },
      { kind: "tiptap", name: "webpage-export", html: GDOCS_WEBPAGE_EXPORT },
      { kind: "tiptap", name: "marks", html: GDOCS_MARKS },
      { kind: "tiptap", name: "prewrap", html: GDOCS_PREWRAP },
      { kind: "tiptap", name: "sheets", html: GDOCS_SHEETS },
      // What the round-tripped prewrap HTML actually computes to in a browser.
      { kind: "render", name: "prewrap-after", html: "<p>alpha    beta   gamma</p>" },
      { kind: "document", name: "doc-webpage-export-preview", stored: GDOCS_WEBPAGE_EXPORT, preview: true },
      { kind: "document", name: "doc-webpage-export-raw", stored: GDOCS_WEBPAGE_EXPORT },
      { kind: "document", name: "doc-clipboard-raw", stored: GDOCS_CLIPBOARD },
    ])
  : null;

// The harness reports a different payload per kind; index them by name.
// Empty when there is no browser, so module evaluation cannot throw before the
// suites below get a chance to skip.
const byKind = (kind: string) =>
  Object.fromEntries(
    (results ?? []).filter((r) => r.kind === kind).map((r) => [r.name, r]),
  ) as Record<string, any>;
const tip = byKind("tiptap");
const dom = byKind("document");
const rendered = byKind("render");

const needsBrowser = { skip: !BROWSER };

describe.skipIf(needsBrowser.skip)("browser harness sanity", () => {
  it("ran a real headless Chromium and parsed every fixture", () => {
    for (const r of results ?? []) expect(r.ok, JSON.stringify(r).slice(0, 300)).toBe(true);
    expect(Object.keys(tip)).toHaveLength(5);
    expect(Object.keys(dom)).toHaveLength(3);
    expect(Object.keys(rendered)).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// (c) TipTap StarterKit round trip
// ────────────────────────────────────────────────────────────────────────────

describe.skipIf(needsBrowser.skip)("(c) TipTap StarterKit (StarterKit + Image + TableKit) on Google Docs HTML", () => {
  it("DROPS the <b id=docs-internal-guid> wrapper entirely", () => {
    expect(GDOCS_CLIPBOARD).toContain("docs-internal-guid");
    expect(tip.clipboard.roundTrip).not.toContain("docs-internal-guid");
    expect(tip.clipboard.roundTrip).not.toContain("<b");
    // It is unwrapped, not converted to a bold mark: the top-level doc is a
    // list of block nodes with no mark of its own.
    expect(tip.clipboard.json.content.map((n: { type: string }) => n.type))
      .toEqual(["paragraph", "bulletList", "heading", "table"]);
    for (const node of tip.clipboard.json.content) expect(node.marks ?? []).toEqual([]);
  });

  it("DROPS every per-span inline style (font, size, color, background, white-space)", () => {
    const out = tip.clipboard.roundTrip;
    expect(out).not.toContain("font-family");
    expect(out).not.toContain("font-size");
    expect(out).not.toContain("white-space");
    expect(out).not.toContain("background-color");
    expect(out).not.toContain("color:#000000");
    expect(out).not.toContain("line-height");
    expect(out).not.toContain("margin-top");
    // The only style= left in the whole output is TableKit's own column width,
    // which DocEditor asks for with resizable:true (DocEditor.tsx:185).
    expect([...out.matchAll(/style="[^"]*"/g)].map((m) => m[0]))
      .toEqual(['style="min-width: 25px;"', 'style="min-width: 25px;"']);
    // <meta charset="utf-8">, which leads a real Google Docs clipboard payload,
    // is dropped too.
    expect(GDOCS_CLIPBOARD).toContain('<meta charset="utf-8">');
    expect(out).not.toContain("charset");
  });

  it("DROPS the dir attributes", () => {
    expect(GDOCS_CLIPBOARD).toContain('dir="ltr"');
    expect(tip.clipboard.roundTrip).not.toContain("dir=");
  });

  it("PRESERVES the semantic formatting: bold, italic, lists, headings, tables", () => {
    expect(tip.clipboard.roundTrip).toBe(
      '<p>Plain <strong>bold</strong><em> italic</em></p>' +
        "<ul><li><p>bullet one</p></li></ul>" +
        "<h1>Heading</h1>" +
        '<table style="min-width: 25px;"><colgroup><col style="min-width: 25px;"></colgroup>' +
        '<tbody><tr><td colspan="1" rowspan="1"><p>cell</p></td></tr></tbody></table>',
    );
  });

  it("LOSES formatting that is only expressed as an inline style", () => {
    // superscript is vertical-align:super — a style, not a mark. The *text*
    // survives, the superscript does not.
    expect(GDOCS_MARKS).toContain("vertical-align:super");
    expect(tip.marks.roundTrip).toBe(
      '<p><strong>B</strong><em>I</em><u>U</u>sup' +
        '<a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com/x">link</a></p>',
    );
    expect(tip.marks.roundTrip).not.toMatch(/<\/?su[pb]/i);
    // Mark types that survive: bold, italic, underline, link. Nothing else.
    expect(
      [...new Set(tip.marks.json.content[0].content.flatMap((n: { marks?: { type: string }[] }) =>
        (n.marks ?? []).map((m) => m.type)))].sort(),
    ).toEqual(["bold", "italic", "link", "underline"]);
  });

  it("REWRITES links with StarterKit's default target/rel, dropping Google's own", () => {
    expect(tip.marks.roundTrip).toContain('target="_blank"');
    expect(tip.marks.roundTrip).toContain('rel="noopener noreferrer nofollow"');
    expect(tip.marks.roundTrip).not.toContain("color:#1155cc");
  });

  it("keeps the literal spaces but drops the white-space:pre-wrap that made them render", () => {
    // The text nodes still carry the runs of spaces, but nothing declares
    // white-space:pre-wrap any more, so the browser collapses them.
    expect(tip.prewrap.roundTrip).toBe("<p>alpha    beta   gamma</p>");
    expect(tip.prewrap.roundTrip).not.toContain("white-space");
    // Measured in a real browser: the round-tripped paragraph computes to
    // white-space:normal, i.e. the spacing is now purely cosmetic markup.
    const r = rendered["prewrap-after"];
    expect(r.paragraphWhiteSpace).toBe("normal");
    expect(r.preWrapWidth).toBeGreaterThan(r.collapsedWidth);
  });

  it("SILENTLY DISCARDS head/style/script from a Webpage export, including <title>", () => {
    // Round trip is the whole saved tab after the first DocEditor keystroke:
    // onUpdate -> editor.getHTML() (app/components/DocEditor.tsx:193).
    expect(tip["webpage-export"].roundTrip).toBe(
      "<p>Plain <strong>bold</strong></p><h1>Heading</h1><p>marker</p>",
    );
    expect(tip["webpage-export"].roundTrip).not.toContain("<title>");
    expect(tip["webpage-export"].roundTrip).not.toContain("Q3 Planning Doc");
    expect(tip["webpage-export"].roundTrip).not.toContain("<style");
    expect(tip["webpage-export"].roundTrip).not.toContain("<link");
    expect(tip["webpage-export"].roundTrip).not.toContain("<script");
    // ...and class="gdocs-marker" is gone, so Google's own CSS stops matching.
    expect(GDOCS_WEBPAGE_EXPORT).toContain('class="gdocs-marker"');
  });

  it("keeps a Google Sheets table but throws away the generated CSS", () => {
    expect(tip.sheets.roundTrip).toContain("<table");
    expect(tip.sheets.roundTrip).toContain("A1");
    expect(tip.sheets.roundTrip).toContain("B1");
    expect(GDOCS_SHEETS).toContain(GDOCS_SHEETS_MARKER);
    expect(tip.sheets.roundTrip).not.toContain(GDOCS_SHEETS_MARKER);
    expect(tip.sheets.roundTrip).not.toContain(".ss{");
  });

  it("is idempotent after the first round trip (no further drift)", () => {
    const again = runInBrowser([
      { kind: "tiptap", name: "second-pass", html: tip.clipboard.roundTrip },
    ]);
    expect(again[0].roundTrip).toBe(tip.clipboard.roundTrip);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// (b) What a full Google Docs Webpage export actually renders as on a doc tab
// ────────────────────────────────────────────────────────────────────────────

describe.skipIf(needsBrowser.skip)("(b) real-browser parse of a doc tab holding a full Google Docs document", () => {
  const p = dom["doc-webpage-export-preview"];

  it("the Google <title> is parsed into <body>, not <head>", () => {
    // A <title> in body is invalid HTML. document.title still picks it up
    // (the spec's getter reads the first <title> wherever it is), so the title
    // is not lost on this path — but only by accident, and it is destroyed by
    // the first DocEditor save (see the round-trip test above).
    expect(p.titleElements).toEqual(["Q3 Planning Doc"]);
    expect(p.titleParents).toEqual(["BODY"]);
    expect(p.docTitle).toBe("Q3 Planning Doc");
    // ...while the app's own injection went into the real <head>.
    expect(p.headElements).toBe(1);
    expect(GDOCS_WEBPAGE_EXPORT).toContain("<title>Q3 Planning Doc</title>");
  });

  it("the nested html/head/body/doctype are dropped by the parser", () => {
    expect(p.htmlElements).toBe(1);
    expect(p.headElements).toBe(1);
    expect(p.bodyElements).toBe(1);
    // ...but the *string* really is a doubled document.
    expect(p.resolved.match(/<!DOCTYPE/gi)).toHaveLength(2);
  });

  it("the Google <style> is still live and WINS the cascade over the app's prose styles", () => {
    // It is not hoisted into <head> — it sits in <body> — but a <style> element
    // applies document-wide wherever it appears, and it comes last, so it
    // overrides PROSE_STYLE (doc.ts:10) and htmlDefaults' DEFAULT_STYLE.
    expect(p.markerColor).toBe("rgb(1, 2, 3)");
    const googleStyle = p.styles.filter((s: { inHead: boolean }) => !s.inHead);
    expect(googleStyle.length).toBeGreaterThan(0);
    expect(googleStyle[0].rules).toBeGreaterThan(0);
    // The Google <link rel=stylesheet> to fonts.googleapis.com survives too.
    expect(p.linkElements).toBeGreaterThanOrEqual(4);
  });

  it("the Google <script> is also live (doc tabs run with script-src 'unsafe-inline')", () => {
    // 2 injected by htmlDefaults (THEME_SCRIPT, LINK_SCRIPT) + 1 from Google.
    expect(p.scriptElements).toBe(3);
  });

  it("the same holds on the /raw path, which does not inject the preview meta CSP", () => {
    const r = dom["doc-webpage-export-raw"];
    expect(r.titleParents).toEqual(["BODY"]);
    expect(r.docTitle).toBe("Q3 Planning Doc");
    expect(r.markerColor).toBe("rgb(1, 2, 3)");
    expect(r.scriptElements).toBe(3);
    expect(r.resolved).not.toContain("Content-Security-Policy");
  });

  it("a correct doc tab (clipboard fragment) parses cleanly", () => {
    const c = dom["doc-clipboard-raw"];
    expect(c.htmlElements).toBe(1);
    expect(c.headElements).toBe(1);
    expect(c.bodyElements).toBe(1);
    expect(c.titleElements).toEqual([]);
    expect(c.docTitle).toBe("");
    expect(c.h1Text).toEqual(["Heading"]);
    expect(c.bodyText).toContain("Plain bold italic");
  });
});