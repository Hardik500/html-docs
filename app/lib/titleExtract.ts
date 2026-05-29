import { parse } from "node-html-parser";

/**
 * Extract the text content of the <title> element from an HTML string.
 * Falls back to the provided default if no title is found or it's empty.
 */
export function extractTitle(html: string, fallback: string): string {
  try {
    const root = parse(html);
    const title = root.querySelector("title")?.text?.trim();
    return title || fallback;
  } catch {
    return fallback;
  }
}
