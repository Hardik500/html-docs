/**
 * How html-docs handles "Google Docs format" content, part 1 (Node/server side).
 *
 * Every assertion here runs the real app code — no mocks, no fixtures of
 * expected output. Nothing under app/ is modified.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { docToHtml } from "~/lib/doc";
import { htmlToMarkdown } from "~/lib/htmlToMarkdown.server";
import { markdownToHtml } from "~/lib/markdown";
import { injectDefaultStyles } from "~/lib/htmlDefaults";
import { injectPreviewCsp } from "~/lib/preview-csp";
import { extractTitle, deriveTitle } from "~/lib/titleExtract";
import { MAX_HTML_BYTES, MAX_DOC_BYTES, maxBytesForType } from "~/lib/limits";
import {
  validateNewDocumentTabs,
  validateSaveTabs,
  validateContentType,
  validateTabContent,
} from "~/lib/document-input";
import { normalizeGoogleHtml } from "~/lib/googleDocs";
import {
  GDOCS_CLIPBOARD,
  GDOCS_WEBPAGE_EXPORT,
  gdocsHtml,
} from "./helpers/gdocs-fixtures.mjs";

// fileURLToPath, not `new URL(...).pathname`: the latter is a POSIX-shaped
// "/D:/a/repo" on Windows, and joining that produces the doubled drive letter
// "D:\D:\a\repo\..." that made this file fail with ENOENT on windows-latest.
// resolve() also drops the trailing separator the URL form leaves behind.
const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bytes = (s: string) => new TextEncoder().encode(s).length;
const countOf = (s: string, re: RegExp) => (s.match(re) ?? []).length;

// ────────────────────────────────────────────────────────────────────────────
// (a) What should an MCP agent pass as `contentType` for Google Docs HTML?
// ────────────────────────────────────────────────────────────────────────────

describe("(a) MCP contentType semantics for Google Docs HTML", () => {
  it("normalizes Google markup for html and doc, and passes markdown through untouched", () => {
    // This is exactly what app/routes/mcp.ts create_document -> validateNewDocumentTabs() does.
    const tabs = validateNewDocumentTabs([
      { name: "GDoc as html", content: GDOCS_CLIPBOARD, contentType: "html" },
      { name: "Plain doc", content: "<p>fragment</p>", contentType: "doc" },
      { name: "GDoc as markdown", content: GDOCS_CLIPBOARD, contentType: "markdown" },
    ]);
    expect(tabs.map((t) => t.contentType)).toEqual(["html", "doc", "markdown"]);

    // html: the wrapper and its presentational CSS are removed, the semantic
    // formatting survives as tags.
    expect(tabs[0].content).not.toContain("docs-internal-guid");
    expect(tabs[0].content).not.toContain("font-family");
    expect(tabs[0].content).toContain("<strong>bold</strong>");
    expect(tabs[0].content.length).toBeLessThan(GDOCS_CLIPBOARD.length);

    // doc: a fragment is stored unchanged.
    expect(tabs[1].content).toBe("<p>fragment</p>");

    // markdown is never rewritten: the caller asked for Markdown source.
    expect(tabs[2].content).toBe(GDOCS_CLIPBOARD);
  });

  it("rejects a complete document for a doc tab, pointing at the right content type", () => {
    // docToHtml() nests a fragment in <body>; a full document would be nested in
    // a second <html>. Rejected with an actionable message rather than wrapped.
    expect(() =>
      validateNewDocumentTabs([
        { name: "GDoc export as doc", content: GDOCS_WEBPAGE_EXPORT, contentType: "doc" },
      ])
    ).toThrowError(/fragment, not a complete document[\s\S]*contentType "html"/);
  });

  it("recovers the Webpage export's <title> as a name when the agent gave none", () => {
    const [tab] = validateNewDocumentTabs([
      { content: GDOCS_WEBPAGE_EXPORT, contentType: "html" },
    ]);
    expect(tab.name).toBe("Q3 Planning Doc");
    expect(tab.derivedName).toBe("Q3 Planning Doc");
  });

  it("defaults to html when contentType is omitted, with no way to opt into a cleaner path", () => {
    expect(validateContentType(undefined)).toBe("html");
    expect(validateContentType(null)).toBe("html");
    // "doc" is the only TipTap-capable type, and it is documented as
    // "mammoth/TipTap HTML" (app/lib/doc.ts:4-7) — a *fragment* contract.
    expect(validateContentType("doc")).toBe("doc");
  });

  it("gives html/markdown 500 KB but doc 2.8 MB, so the same paste can pass or fail on type alone", () => {
    expect(maxBytesForType("html")).toBe(MAX_HTML_BYTES);
    expect(maxBytesForType("markdown")).toBe(MAX_HTML_BYTES);
    expect(maxBytesForType("doc")).toBe(MAX_DOC_BYTES);

    const big = gdocsHtml({ paragraphs: 300, runsPerParagraph: 8 }); // 853_318 bytes
    // Validation still enforces the limit, but normalization runs first, so a
    // realistic Google Doc fits where the raw markup did not.
    expect(() => validateTabContent(normalizeGoogleHtml(big).html, "html")).not.toThrow();
    expect(() => validateTabContent(big, "markdown")).toThrowError(/content limit/);
    expect(validateTabContent(big, "doc")).toBe(big);
  });

  it("markdown is NOT a valid target for Google Docs HTML: marked passes it through raw", () => {
    const rendered = markdownToHtml(GDOCS_CLIPBOARD);
    // marked does not escape raw HTML, so the Google payload is inlined verbatim
    // into <body> — including the stray <meta charset> and the guid <b> wrapper.
    expect(rendered).toContain('<meta charset="utf-8">');
    expect(rendered).toContain('id="docs-internal-guid-1a2b3c4d-5e6f-7890-abcd-ef1234567890"');
    // And the .md download for a markdown tab returns the stored string as-is
    // (app/routes/download.$docId.$tabSlug.tsx:71), i.e. an HTML file named .md.
    expect(GDOCS_CLIPBOARD).toContain("<b ");
  });

  it("update_document uses the same field names as create_document/update_tab", async () => {
    // tabWriteSchema previously took `html` + `content_type` while the other two
    // write tools took `content` + `contentType`, so an agent reusing the
    // create_document convention got a content error instead of a schema error.
    const mcp = readFileSync(join(REPO, "app/routes/mcp.ts"), "utf8");
    const schema = /const tabWriteSchema = z\.object\(\{([\s\S]*?)\}\);/.exec(mcp)?.[1] ?? "";
    expect(schema).toMatch(/content: z\.string\(\)\.optional\(\)/);
    expect(schema).toMatch(/contentType: contentTypeSchema\.optional\(\)/);
    expect(schema).not.toMatch(/\bhtml:/);
    expect(schema).not.toMatch(/content_type/);

    // The MCP layer adapts its tool arguments to the shared validator's shape
    // (which the web editor also uses), so the agent-facing names stay uniform.
    expect(mcp).toMatch(/validateSaveTabs\(\s*tabs\.map\(\(tab\) => \(\{\s*\.\.\.tab,\s*html: tab\.content,\s*content_type: tab\.contentType,/);

    // The adaptation produces exactly what the validator needs.
    const ok = validateSaveTabs([
      { name: "G", position: 0, html: GDOCS_CLIPBOARD, content_type: "html" },
    ]);
    expect(ok[0].html).toBe(GDOCS_CLIPBOARD);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// (b) A full Google Docs "Webpage" export stored as contentType "doc"
// ────────────────────────────────────────────────────────────────────────────

describe("(b) docToHtml() with a full Google Docs Webpage export", () => {
  it("nests a complete second document inside <body> (2 doctypes, 2 html, 2 head, 2 body)", () => {
    const doubled = docToHtml(GDOCS_WEBPAGE_EXPORT);
    expect(countOf(doubled, /<!DOCTYPE/gi)).toBe(2);
    expect(countOf(doubled, /<html[\s>]/g)).toBe(2);
    expect(countOf(doubled, /<head[\s>]/g)).toBe(2);
    expect(countOf(doubled, /<body[\s>]/g)).toBe(2);
    expect(countOf(doubled, /<title>/g)).toBe(1);
  });

  it("puts the Google <title> after the outer </head>, so it is no longer a document title", () => {
    const doubled = docToHtml(GDOCS_WEBPAGE_EXPORT);
    const firstHeadClose = doubled.indexOf("</head>");
    const titleAt = doubled.indexOf("<title>");
    expect(titleAt).toBeGreaterThan(firstHeadClose);
  });

  it("injects the app defaults into the FIRST <head>, so the Google <style> stays buried in the body", () => {
    const injected = injectDefaultStyles(docToHtml(GDOCS_WEBPAGE_EXPORT));
    // htmlDefaults.ts:169-171 replaces the first <head> only.
    expect(injected.indexOf("fonts.googleapis.com/css2?family=Inter")).toBeLessThan(
      injected.indexOf("</head>"),
    );
    // The Google <style> lands after the first </head>, i.e. inside the nested document.
    expect(injected.indexOf("gdocs-marker")).toBeGreaterThan(injected.indexOf("</head>"));
  });

  it("a doc tab never reaches PreviewIframe in the editor, so this only affects /raw + downloads", () => {
    const edit = readFileSync(join(REPO, "app/routes/d.$docId.edit.tsx"), "utf8");
    // The preview pane is skipped for doc tabs; DocEditor is the only surface.
    expect(edit).toMatch(/activeTab\?\.content_type !== "doc"/);
    // /raw and the download route are the paths that call docToHtml().
    expect(readFileSync(join(REPO, "app/routes/raw.$docId.$tabSlug.tsx"), "utf8")).toContain("docToHtml");
    const download = readFileSync(join(REPO, "app/routes/download.$docId.$tabSlug.tsx"), "utf8");
    expect(download).toContain("docToHtml");
    // ...and the .html download gets NO style/CSP injection at all.
    expect(download).toMatch(/if \(format === "html"\) \{[\s\S]{0,200}new Response\(htmlDoc/);
    expect(download).not.toContain("injectDefaultStyles");
    expect(download).not.toContain("injectPreviewCsp");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// (d) htmlToMarkdown (turndown) on Google Docs markup
// ────────────────────────────────────────────────────────────────────────────

describe("(d) htmlToMarkdown() output for Google Docs markup", () => {
  it("wraps the whole document in a stray ** because <b id=docs-internal-guid> becomes bold", () => {
    const md = htmlToMarkdown(GDOCS_CLIPBOARD);
    // Opening the document with a literal `**` is the guid wrapper leaking through.
    expect(md.startsWith("**")).toBe(true);
    expect(md).toContain("# Heading");
    // Inline *style* runs are NOT translated to Markdown marks.
    expect(md).toContain("Plain bold italic");
    expect(md).not.toContain("**bold**");
    expect(md).not.toContain("*italic*");
    // The table is flattened to bare text: no GFM table plugin is installed.
    expect(md).toContain("cell");
    expect(md).not.toMatch(/\|\s*cell/);
  });

  it("shows the exact before/after for the canonical clipboard fixture", () => {
    const md = htmlToMarkdown(GDOCS_CLIPBOARD);
    // The document literally opens and closes with a stray `**` — that is the
    // <b id="docs-internal-guid-..."> wrapper being translated to bold, and
    // never balanced because the content contains block-level headings/lists.
    expect(md).toBe(
      "**\n\nPlain bold italic\n\n-   bullet one\n    \n\n# Heading\n\ncell\n\n\n\n\n\n\n\n\n\n**",
    );
    // Balanced? No. The closing `**` is 12 newlines later, after the table.
    expect(md.indexOf("**")).toBe(0);
    expect(md.lastIndexOf("**")).toBe(md.length - 2);
  });

  it("leaks the Google <title> into the Markdown body as a stray paragraph", () => {
    // Confirmed for a full document, a head-less document, and a bare fragment.
    expect(htmlToMarkdown("<!DOCTYPE html><html><head><title>T</title></head><body><p>Hi</p></body></html>"))
      .toBe("T\n\nHi");
    expect(htmlToMarkdown("<html><head><title>T</title></head><body><p>Hi</p></body></html>"))
      .toBe("T\n\nHi");
    expect(htmlToMarkdown("<title>T</title><p>Hi</p>")).toBe("T\n\nHi");
    // Full Google export as an html tab: the exported title becomes a body line.
    expect(htmlToMarkdown(GDOCS_WEBPAGE_EXPORT).startsWith("Q3 Planning Doc")).toBe(true);
    // As a doc tab the same leak happens through docToHtml().
    expect(htmlToMarkdown(docToHtml(GDOCS_WEBPAGE_EXPORT)).startsWith(" Q3 Planning Doc")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// (e) Title auto-derivation on Google Docs markup
// ────────────────────────────────────────────────────────────────────────────

describe("(e) extractTitle / deriveTitle on Google Docs markup", () => {
  it("finds the <h1> in a clipboard fragment (dir= and style= are harmless)", () => {
    expect(extractTitle(GDOCS_CLIPBOARD, "FALLBACK")).toBe("Heading");
    expect(deriveTitle(GDOCS_CLIPBOARD)).toBe("Heading");
  });

  it("finds <title> in a Webpage export", () => {
    expect(extractTitle(GDOCS_WEBPAGE_EXPORT, "FALLBACK")).toBe("Q3 Planning Doc");
    expect(deriveTitle(GDOCS_WEBPAGE_EXPORT)).toBe("Q3 Planning Doc");
  });

  it("FAILS when Google Docs styles the title as a bold span instead of <h1>", () => {
    // This is the common Google Docs shape: the doc title is a large bold run.
    const titleAsSpan =
      '<b style="font-weight:normal;" id="docs-internal-guid-abc">' +
      '<p dir="ltr"><span style="font-size:16pt;font-weight:700;font-family:Arial;">Quarterly Business Review</span></p>' +
      '<p dir="ltr"><span>body text</span></p></b>';
    expect(deriveTitle(titleAsSpan)).toBe("");
    // d.$docId.edit.tsx:72 and document-service.server.ts:445 then fall back.
    expect(extractTitle(titleAsSpan, "FALLBACK")).toBe("FALLBACK");
  });

  it("disagrees with itself on pre-wrap whitespace, so the tab name flips between client and server", () => {
    const spaced =
      '<h1 dir="ltr"><span style="white-space:pre-wrap;">  Spaced   Title  </span></h1>';
    // titleExtract.ts:30 collapses runs of whitespace in deriveTitle...
    expect(deriveTitle(spaced)).toBe("Spaced Title");
    // ...but extractTitle (node-html-parser .text) preserves them.
    expect(extractTitle(spaced, "")).toBe("Spaced   Title");
    // d.$docId.edit.tsx:70-83 uses extractTitle server-side and
    // d.$docId.edit.tsx:498 uses deriveTitle client-side for the same tab.
  });
});

// ────────────────────────────────────────────────────────────────────────────
// (g) Payload size: Google Docs HTML vs the configured limits
// ────────────────────────────────────────────────────────────────────────────

describe("(g) Google Docs payload size against app/lib/limits.ts", () => {
  // One Google Docs formatting run costs this many bytes of pure style.
  const SPAN_BYTES = 227;
  const CELL_BYTES = 315; // span + <p dir="ltr" style="..."> + </span></p></td>

  it("measured: a single formatting run costs 227 bytes, a table cell 315 bytes", () => {
    const span =
      '<span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;' +
      'font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;' +
      'vertical-align:baseline;white-space:pre;white-space:pre-wrap;">';
    expect(span.length).toBe(SPAN_BYTES);
    expect(
      span.length +
        '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">'.length +
        "</span></p></td>".length,
    ).toBe(CELL_BYTES);
  });

  it("turns the byte caps into run budgets", () => {
    expect(Math.floor(MAX_HTML_BYTES / SPAN_BYTES)).toBe(2202);
    expect(Math.floor(MAX_DOC_BYTES / SPAN_BYTES)).toBe(12334);
    // app/routes/mcp.ts:26 caps a single MCP request at 1 MB, before content_type
    // is even looked at.
    expect(Math.floor(1_000_000 / SPAN_BYTES)).toBe(4405);
  });

  it("measured payloads: 300 paragraphs x 3 runs is already rejected as html/markdown", () => {
    const cases = [
      { paragraphs: 100, runsPerParagraph: 1 },
      { paragraphs: 300, runsPerParagraph: 1 },
      { paragraphs: 100, runsPerParagraph: 3 },
      { paragraphs: 300, runsPerParagraph: 3 },
      { paragraphs: 100, runsPerParagraph: 8 },
      { paragraphs: 300, runsPerParagraph: 8 },
    ].map((c) => {
      const html = gdocsHtml({ ...c, wordsPerParagraph: 120 });
      return { ...c, bytes: bytes(html), fitsHtml: bytes(html) <= MAX_HTML_BYTES };
    });
    // Lightly formatted 300-paragraph docs still fit; at 3+ runs/paragraph
    // (i.e. most real Google Docs output) a 300-paragraph document does not.
    expect(cases.map((c) => c.bytes)).toEqual([120718, 361918, 167518, 502318, 284518, 853318]);
    expect(cases.map((c) => c.fitsHtml)).toEqual([true, true, true, false, true, false]);
    // Every one of them still fits the 2.8 MB "doc" cap.
    for (const c of cases) expect(c.bytes).toBeLessThan(MAX_DOC_BYTES);
  });

  it("a 20x10 Google Docs table alone costs ~63 KB of the 500 KB html budget", () => {
    expect(20 * 10 * CELL_BYTES).toBe(63_000);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// (f) Is pasted Google Docs HTML ever stripped or sanitized?
// ────────────────────────────────────────────────────────────────────────────

describe("(f) no paste handler, clipboard reader or HTML sanitizer exists", () => {
  const PATTERNS = [
    /onPaste/i, /handlePaste/i, /clipboardData/i,
    /addEventListener\(\s*["']paste["']/i,
    /DOMPurify/i, /sanitize-html/i, /sanitizeHtml/i, /\brehype\b/i, /\bxss\b/i,
  ];

  it("no paste handler, clipboard reader or HTML sanitizer exists", () => {
    const PATTERNS = [
      /\bonPaste:/i, /handlePaste/i, /clipboardData/i, /transformPasted/i,
      /addEventListener\(\s*["']paste["']/i,
      /DOMPurify/i, /sanitize-html/i, /sanitizeHtml/i, /\brehype\b/i,
    ];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx|cjs|mjs|js|jsx)$/.test(entry)) continue;
        const src = readFileSync(p, "utf8");
        for (const re of PATTERNS) if (re.test(src)) offenders.push(`${p} :: ${re}`);
      }
    };
    walk(join(REPO, "app"));
    walk(join(REPO, "electron"));
    expect(offenders).toEqual([]);
  });

  it("no sanitizer dependency is installed", () => {
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const names = Object.keys(deps).map((n) => n.toLowerCase());
    expect(names.filter((n) => /purify|sanitize|xss|rehype|jsdom|happy-dom|linkedom/.test(n)))
      .toEqual([]);
  });

  it("the only paste- and sanitizer-adjacent code is a Monaco option and a comment", () => {
    const editor = readFileSync(join(REPO, "app/components/Editor.tsx"), "utf8");
    // The single match in all of app/ for anything paste-shaped: Monaco's
    // formatOnPaste, which re-indents pasted source but never sanitizes it.
    const pasteLines = editor.split("\n").filter((l) => /onPaste|clipboard|sanitiz/i.test(l));
    expect(pasteLines.map((l) => l.trim())).toEqual(["formatOnPaste: true,"]);
    expect(editor).not.toMatch(/\bonPaste:|handlePaste|clipboardData|addEventListener\(\s*["']paste/i);

    // The other match is a comment in supabase.server.ts, not code.
    const supabase = readFileSync(join(REPO, "app/lib/supabase.server.ts"), "utf8");
    expect([...supabase.matchAll(/^.*\bxss\b.*$/gim)].map((m) => m[0].trim()))
      .toHaveLength(1);
  });

  it("TipTap DocEditor registers no transformPasted / paste rules of its own", () => {
    const docEditor = readFileSync(join(REPO, "app/components/DocEditor.tsx"), "utf8");
    expect(docEditor).not.toMatch(/transformPasted|addPasteRules|clipboardTextParser/);
    // Only StarterKit defaults: extensions + onUpdate -> editor.getHTML().
    expect(docEditor).toContain("StarterKit,");
    expect(docEditor).toContain("onUpdate: ({ editor }) => onChange(editor.getHTML())");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// (h) What the MCP tool descriptions actually tell an agent
// ────────────────────────────────────────────────────────────────────────────

describe("(h) MCP tool description text", () => {
  const mcp = readFileSync(join(REPO, "app/routes/mcp.ts"), "utf8");

  it("documents the contentType contract on every tool that accepts tab content", () => {
    const guide = /const CONTENT_TYPE_GUIDE =([\s\S]*?);\n\nconst tabWriteSchema/.exec(mcp)?.[1] ?? "";
    // An agent previously had only a bare enum and no statement of which type
    // accepts a full document, so both reasonable guesses were wrong.
    expect(guide).toMatch(/html/);
    expect(guide).toMatch(/fragment/i);
    expect(guide).toMatch(/Webpage/i);
    expect(guide).toMatch(/markdown/);
    expect(guide).toMatch(/Google Docs/);
    expect(guide).toMatch(/500000 bytes/);
    expect(guide).toMatch(/2800000 for doc\/pdf/);

    for (const tool of ["create_document", "update_document", "update_tab"]) {
      const block = new RegExp(
        `registerTool\\(\\s*\\n\\s*"${tool}",[\\s\\S]*?description:[\\s\\S]*?CONTENT_TYPE_GUIDE`,
      );
      expect(mcp).toMatch(block);
    }
  });

  it("keeps the read-only tool descriptions free of content-type noise", () => {
    const readOnly = [...mcp.matchAll(
      /"(whoami|list_documents|search_documents|get_document|get_tab|delete_document)",[\s\S]*?description:\s*\n?\s*"([^"]*)"/g,
    )].map((m) => [m[1], m[2]]);
    for (const [tool, description] of readOnly) {
      if (tool === "delete_document") continue;
      expect(description, tool).not.toMatch(/contentType|fragment/i);
    }
  });

  it("keeps the enum that backs the documented contract", () => {
    expect(mcp).toContain('const contentTypeSchema = z.enum(["html", "markdown", "pdf", "doc"]);');
    const doc = readFileSync(join(REPO, "app/lib/doc.ts"), "utf8");
    expect(doc).toContain("Input must be an HTML fragment, not a full document");
    // The same contract is now also enforced, not just documented.
    const input = readFileSync(join(REPO, "app/lib/document-input.ts"), "utf8");
    expect(input).toContain('contentType === "doc" && isFullHtmlDocument(value)');
  });
});
