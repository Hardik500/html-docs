/**
 * Normalization for Google Docs / Google Sheets HTML.
 *
 * Google Docs wraps exported and pasted content in
 * `<b style="font-weight:normal" id="docs-internal-guid-…">` and emits one
 * `<span style="…">` per formatting run, carrying ~227 bytes of presentational
 * CSS per run. Google Sheets adds a `google-sheets-html-origin` marker and a
 * generated stylesheet. A "Webpage (.html)" export is a complete document whose
 * `<head>` carries a `<title>`, a Google Fonts link and a generated `<style>`.
 *
 * Left alone, this markup causes four concrete problems in this codebase:
 *
 *  1. `htmlToMarkdown()` maps the wrapper `<b>` to bold, so a Google Docs export
 *     becomes a Markdown file wrapped in unbalanced `**` (`app/lib/doc.ts:7`
 *     shows the wrapper is not meant to be meaningful markup at all).
 *  2. A 300-paragraph Google Doc with 3 formatting runs per paragraph is 502 KB
 *     of which almost none is text, which is over the 500 KB `html`/`markdown`
 *     per-tab limit in `app/lib/limits.ts` and gets an opaque 413.
 *  3. TipTap cannot represent the presentational styles, so the first keystroke
 *     in a `doc` tab silently rewrites the stored source and drops them anyway.
 *  4. Nothing anywhere removes the wrapper, the `dir` attributes, or the
 *     `docs-internal-guid` id, so they persist into every export.
 *
 * This converts the markup into the semantic subset the app already
 * understands: the wrapper is removed, presentational CSS is dropped, and
 * `font-weight` / `font-style` / `text-decoration` are promoted to `<strong>`,
 * `<em>` and `<u>`.
 *
 * Two deliberate limits:
 *  - It does **not** unwrap a full HTML document. Full documents render fine in
 *    the preview and at `/raw`; the one place they break is `contentType:
 *    "doc"`, which is rejected at validation time instead
 *    (`isFullHtmlDocument`).
 *  - It is a no-op for content that is not Google-shaped, so it is safe to call
 *    on any HTML.
 *
 * DOM-free on purpose: it runs in Node route handlers and in the browser, and
 * the repo has no isomorphic HTML parser dependency.
 */

/** Markers only Google-generated markup carries. */
const HARD_MARKERS = [
  "docs-internal-guid",
  "google-sheets-html-origin",
  "themes.googleusercontent.com",
];

/** Cheap check for a real Google "Webpage (.html)" export document. */
const GOOGLE_FONTS_LINK = /<link[^>]+href\s*=\s*["'][^"']*fonts\.googleapis\.com/i;

/** True when the markup carries Google Docs/Sheets artifacts worth normalizing. */
export function looksLikeGoogleHtml(html: string): boolean {
  if (!html || html.length < 24) return false;
  // This runs on every agent write and almost all content is ordinary HTML, so
  // keep the common path to one substring scan.
  for (const marker of HARD_MARKERS) {
    if (html.includes(marker)) return true;
  }
  return isFullHtmlDocument(html) && GOOGLE_FONTS_LINK.test(html);
}

const DOCTYPE = /<!doctype[^>]*>/i;
const HTML_OPEN = /<html\b/i;

/**
 * True when `html` is a complete document rather than a fragment.
 *
 * `doc` tabs are stored as fragments and wrapped by `docToHtml()`, which would
 * nest a second `<html>` inside `<body>`; the check that guards that lives
 * alongside the byte-limit check in `document-input.ts`.
 */
export function isFullHtmlDocument(html: string): boolean {
  return DOCTYPE.test(html) || HTML_OPEN.test(html);
}

export interface NormalizedGoogleHtml {
  /** The cleaned HTML, safe to store in an `html` or `doc` tab. */
  html: string;
  /** The document `<title>` when the input carried one. */
  title?: string;
  /** True when the input was recognized as Google markup and rewritten. */
  changed: boolean;
}

const TITLE = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
const STYLE_ATTR = /\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi;
/** Direction, Google's generated class names and legacy alignment: not content. */
const NOISE_ATTR = /\s(dir|class|align)\s*=\s*(["'])([\s\S]*?)\2/gi;
const GUID_ID = /\s*id\s*=\s*(["'])docs-internal-guid-[^"']*\1/gi;

/**
 * Style properties dropped from every tag. The run-formatting properties are
 * included unconditionally: this normalizer always expresses them semantically
 * (`<strong>`, `<em>`, `<u>`, `<s>`, `<sup>`), and a "off" value such as
 * `font-weight:normal` has no semantic tag to promote to, so keeping it as CSS
 * would only preserve noise.
 */
const DROPPED_STYLE = new Set([
  "background-color",
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "line-height",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "text-decoration",
  "text-indent",
  "vertical-align",
  "white-space",
  "width",
  "word-spacing",
]);

/** Tags whose meaning in Google markup is carried by their inline style. */
const RUN_TAGS = new Set([
  "span", "b", "i", "u", "s", "strike", "sub", "sup", "code", "font", "div", "mark",
]);

/** Any start or end tag, so unrelated markup is copied through verbatim. */
const TAG_SCANNER = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  code?: boolean;
}

/** Reads the semantic subset out of a Google Docs run style declaration. */
function readRunStyle(style: string): RunStyle {
  const weight = /font-weight\s*:\s*([0-9]+|bold(?:er)?)/i.exec(style)?.[1];
  const verticalAlign = /vertical-align\s*:\s*([a-z-]+)/i.exec(style)?.[1]?.toLowerCase();
  return {
    // Google emits 400/700/bolder. 600 and up reads as bold; note that 400 must
    // NOT match here.
    bold: weight != null && (weight === "bold" || /^[6-9]00$/.test(weight)),
    italic: /font-style\s*:\s*italic/i.test(style),
    underline: /text-decoration(?:-line)?\s*:[^;]*underline/i.test(style),
    strike: /text-decoration(?:-line)?\s*:[^;]*line-through/i.test(style),
    superscript: verticalAlign === "super",
    subscript: verticalAlign === "sub",
    code: /font-family\s*:[^;]*(?:monospace|menlo|consolas|courier)/i.test(style),
  };
}

function semanticTagFor(name: string, run: RunStyle): string {
  if (run.code) return "code";
  if (run.bold) return "strong";
  if (run.italic) return "em";
  if (run.underline) return "u";
  if (run.strike) return "s";
  if (run.superscript) return "sup";
  if (run.subscript) return "sub";
  if (name === "font" || name === "div" || name === "mark") return "span";
  if (name === "b") return "strong";
  if (name === "i") return "em";
  return name;
}

/** Style properties that the chosen semantic tag now expresses on its own. */
function promotedProperties(run: RunStyle): Set<string> {
  const promoted = new Set<string>();
  if (run.bold) promoted.add("font-weight");
  if (run.italic) promoted.add("font-style");
  if (run.underline || run.strike) promoted.add("text-decoration");
  if (run.superscript || run.subscript) promoted.add("vertical-align");
  if (run.code) promoted.add("font-family");
  return promoted;
}

function readStyleAttr(attrs: string): string {
  STYLE_ATTR.lastIndex = 0;
  return STYLE_ATTR.exec(attrs)?.[2] ?? "";
}

function stripStyle(style: string, alsoDrop: Set<string>): string {
  if (!style.trim()) return "";
  const kept = style
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .filter((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator === -1) return false;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      return !DROPPED_STYLE.has(property) && !alsoDrop.has(property);
    });
  return kept.length ? ` style="${kept.join(";")}"` : "";
}

/**
 * Keeps only the attributes worth carrying over. `style` is dropped here
 * because it is re-emitted (filtered) by stripStyle — leaving it in would append
 * a second, unfiltered style attribute.
 */
function stripNoiseAttrs(attrs: string): string {
  const result = attrs
    .replace(NOISE_ATTR, "")
    .replace(GUID_ID, "")
    .replace(STYLE_ATTR, "")
    .replace(/\s+/g, " ")
    .trim();
  return result ? ` ${result}` : "";
}

interface OpenRun {
  source: string;
  /** null when the element is removed entirely, as the wrapper is. */
  emitted: string | null;
}

/**
 * Single pass over the tag stream with a stack, so every closing tag is rewritten
 * to match the tag its own opening was converted to. Two independent regex
 * passes get this wrong as soon as a `<span>` becomes a `<strong>`.
 *
 * Every tag is cleaned, not just the run tags: Google puts its heaviest CSS on
 * `<p>`, `<td>` and `<h1>` too. Only run tags can change name, because only
 * they carry formatting in their inline style.
 */
function rewriteTags(source: string): string {
  const stack: OpenRun[] = [];
  let out = "";
  let cursor = 0;

  TAG_SCANNER.lastIndex = 0;
  for (let match = TAG_SCANNER.exec(source); match; match = TAG_SCANNER.exec(source)) {
    const [whole, closing, rawName, attrs] = match;
    const name = rawName.toLowerCase();

    // The docs-internal-guid wrapper is a container that Google happens to spell
    // with <b>. It is removed outright, keeping its children.
    const isWrapper = !closing && name === "b" && /docs-internal-guid/i.test(attrs);
    const isRunTag = RUN_TAGS.has(name);
    if (!isWrapper && !isRunTag && !presentationalAttrs(attrs)) continue;

    out += source.slice(cursor, match.index);
    cursor = match.index + whole.length;

    if (closing) {
      const index = stack.map((run) => run.source).lastIndexOf(name);
      if (index === -1) continue;
      while (stack.length > index) {
        const run = stack.pop()!;
        if (run.emitted) out += `</${run.emitted}>`;
      }
      continue;
    }

    if (isWrapper) {
      stack.push({ source: name, emitted: null });
      continue;
    }

    const style = readStyleAttr(attrs);
    const run = isRunTag ? readRunStyle(style) : {};
    const tag = isRunTag ? semanticTagFor(name, run) : name;
    const kept = stripStyle(style, promotedProperties(run)) + stripNoiseAttrs(attrs);
    // Non-run tags are not tracked on the stack: their name never changes, so
    // their closing tag needs no rewriting.
    if (isRunTag) stack.push({ source: name, emitted: tag });
    out += `<${tag}${kept}>`;
  }

  out += source.slice(cursor);
  while (stack.length) {
    const run = stack.pop()!;
    if (run.emitted) out += `</${run.emitted}>`;
  }
  return out;
}

/** True when an element carries only attributes this normalizer would drop. */
function presentationalAttrs(attrs: string): boolean {
  if (!attrs.trim()) return false;
  const noise = attrs.replace(NOISE_ATTR, "").replace(GUID_ID, "").replace(STYLE_ATTR, "").trim();
  if (noise) return false;
  return /style\s*=/i.test(attrs) || /\s(dir|class|align)\s*=/i.test(attrs) ||
    /id\s*=\s*["']docs-internal-guid-/i.test(attrs);
}

/**
 * Converts Google Docs/Sheets HTML into the semantic subset this app stores.
 * Returns the input untouched (with `changed: false`) for non-Google content.
 */
export function normalizeGoogleHtml(input: string): NormalizedGoogleHtml {
  if (!looksLikeGoogleHtml(input)) return { html: input, changed: false };

  const titleMatch = TITLE.exec(input);
  const title = titleMatch?.[1] ? decodeEntities(titleMatch[1].trim()).slice(0, 200) : undefined;

  let html = input
    // A clipboard paste opens with a stray <meta charset>. Neither it nor the
    // stylesheet Google generates for a Webpage export is document content — but
    // a hand-written <link> to the author's own stylesheet is, so only Google's
    // generated font/CDN links are dropped.
    .replace(/<meta\b[^>]*>/gi, "")
    .replace(
      /<link\b[^>]*href\s*=\s*["'][^"']*(?:fonts\.googleapis\.com|fonts\.gstatic\.com|themes\.googleusercontent\.com)[^"']*["'][^>]*>/gi,
      "",
    );

  html = rewriteTags(html);

  return { html: html.trim(), title: title || undefined, changed: true };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}
