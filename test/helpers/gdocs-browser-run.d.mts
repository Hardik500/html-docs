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
