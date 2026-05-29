import { parse } from "node-html-parser";

/**
 * Server-side title extraction using node-html-parser.
 * Priority: <title> → og:title meta → <h1> → <h2> → meta description.
 * Falls back to `fallback` if nothing is found.
 */
export function extractTitle(html: string, fallback: string): string {
  try {
    const root = parse(html);
    const candidate =
      root.querySelector("title")?.text?.trim() ||
      root.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() ||
      root.querySelector("h1")?.text?.trim() ||
      root.querySelector("h2")?.text?.trim() ||
      root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim();
    return (candidate || fallback).slice(0, 200);
  } catch {
    return fallback;
  }
}

/**
 * Lightweight client-safe title derivation using regex (no node-html-parser).
 * Same priority order as extractTitle. Returns "" if nothing is found.
 * Safe to call in browser context (Monaco onChange handlers etc.).
 */
export function deriveTitle(html: string): string {
  // Strip inner tags from a raw match (e.g. <h1><span>Foo</span></h1> → "Foo")
  const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  if (title) return stripTags(title).slice(0, 200);

  const ogTitle =
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i.exec(html)?.[1]?.trim() ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i.exec(html)?.[1]?.trim();
  if (ogTitle) return ogTitle.slice(0, 200);

  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  if (h1) { const t = stripTags(h1); if (t) return t.slice(0, 200); }

  const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1];
  if (h2) { const t = stripTags(h2); if (t) return t.slice(0, 200); }

  const desc =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i.exec(html)?.[1]?.trim() ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i.exec(html)?.[1]?.trim();
  if (desc) return desc.slice(0, 200);

  return "";
}
