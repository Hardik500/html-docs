import { PROSE_STYLE } from "./markdown";

/**
 * Converts a stored doc fragment (mammoth/TipTap HTML) into a full HTML
 * document with prose styles. Mirrors markdownToHtml() minus the parse step;
 * the result can be passed to injectDefaultStyles() like any other document.
 */
export function docToHtml(fragment: string): string {
  return `<!DOCTYPE html>\n<html>\n<head>\n${PROSE_STYLE}\n</head>\n<body>\n${fragment}</body>\n</html>`;
}
