import { marked } from "marked";

/**
 * GitHub-compatible heading slug:
 *   lowercase → strip inline HTML → drop non-alphanumeric/space/hyphen → spaces→hyphens
 *
 * Examples
 *   "MCP Phase 1 – Auth Service"  →  "mcp-phase-1--auth-service"
 *   "1. Getting Started"          →  "1-getting-started"
 */
function headingSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/<[^>]+>/g, "")       // strip any inline HTML (<code> etc.)
    .replace(/[^a-z0-9\s-]/g, "")  // drop punctuation (keeps spaces & hyphens)
    .trim()
    .replace(/\s+/g, "-");         // whitespace → hyphens (intentionally no collapse)
}

// Configure marked once at module load so heading IDs are always present.
// This makes anchor links like [text](#section) scroll correctly in the iframe.
marked.use({
  renderer: {
    heading({ text, depth, raw }: { text: string; depth: number; raw: string }) {
      const id = headingSlug(raw);
      return `<h${depth} id="${id}">${text}</h${depth}>\n`;
    },
  },
});

export const PROSE_STYLE = `<style>
  body { max-width: 800px; margin: 0 auto; padding: 2rem 1rem; }
  h1,h2,h3,h4,h5,h6 { font-weight: 600; line-height: 1.25; margin: 1.5em 0 0.5em; color: var(--color-text-primary); }
  h1 { font-size: 2em; border-bottom: 1px solid var(--color-border-tertiary); padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid var(--color-border-tertiary); padding-bottom: 0.2em; }
  h3 { font-size: 1.25em; }
  p { margin: 0.75em 0; line-height: 1.7; color: var(--color-text-primary); }
  a { color: var(--color-text-info); text-decoration: underline; }
  ul,ol { margin: 0.75em 0; padding-left: 2em; }
  li { margin: 0.25em 0; line-height: 1.6; }
  blockquote { border-left: 4px solid var(--color-border-primary); margin: 1em 0; padding: 0.5em 1em; color: var(--color-text-secondary); }
  pre { background: var(--color-background-secondary); padding: 1em; border-radius: 6px; overflow-x: auto; margin: 1em 0; }
  code { font-family: ui-monospace, monospace; font-size: 0.875em; background: var(--color-background-secondary); padding: 0.15em 0.35em; border-radius: 3px; }
  pre code { background: none; padding: 0; font-size: 0.875em; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th,td { border: 1px solid var(--color-border-secondary); padding: 0.5em 0.75em; text-align: left; }
  th { background: var(--color-background-secondary); font-weight: 600; }
  hr { border: none; border-top: 1px solid var(--color-border-tertiary); margin: 2em 0; }
  img { max-width: 100%; height: auto; border-radius: 6px; }
</style>`;

/**
 * Converts a markdown string into a full HTML document with prose styles.
 * The result can be passed to injectDefaultStyles() like any other HTML document.
 */
export function markdownToHtml(markdown: string): string {
  const body = marked.parse(markdown) as string;
  return `<!DOCTYPE html>\n<html>\n<head>\n${PROSE_STYLE}\n</head>\n<body>\n${body}</body>\n</html>`;
}
