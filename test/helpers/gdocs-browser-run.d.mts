/**
 * Loosely typed on purpose: the harness returns whatever the browser reported.
 * `kind` discriminates the three fixture shapes.
 */
export interface BrowserResult {
  name: string;
  kind: "tiptap" | "document" | "render";
  ok: boolean;
  error?: string;
  // kind === "tiptap"
  json?: { type: string; content?: any[] };
  roundTrip?: string;
  // kind === "document"
  resolved?: string;
  htmlElements?: number;
  headElements?: number;
  bodyElements?: number;
  docTitle?: string;
  titleElements?: string[];
  titleParents?: (string | null)[];
  styleElements?: number;
  linkElements?: number;
  scriptElements?: number;
  styles?: { inHead: boolean; parentTag: string | null; rules: number }[];
  markerColor?: string | null;
  bodyText?: string;
  h1Text?: string[];
  // kind === "render"
  paragraphWhiteSpace?: string | null;
  paragraphFontFamily?: string | null;
  preWrapWidth?: number;
  collapsedWidth?: number;
}

export function runInBrowser(
  fixtures: Array<Record<string, unknown>>,
): BrowserResult[];

/**
 * Resolves a usable Chromium for the harness, or null when there is none.
 *
 * A test calls this to decide whether to skip. `runInBrowser` throws when no
 * browser is found, which is correct for a genuine assertion failure but wrong
 * for "this machine has no browser" — a fresh clone or a CI runner without one.
 * Probing here keeps a missing browser an environment fact rather than a red
 * suite.
 */
export function findChrome(): string | null;
