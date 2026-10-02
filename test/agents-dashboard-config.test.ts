import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(REPO, "app/routes/dashboard.agents.tsx"), "utf8");

/**
 * Every client snippet is now built in `clientPanels()`, one per tab. Extracting
 * them from the source means the test tracks the real data rather than a UI
 * markup shape that can change without touching the payloads.
 */
function jsonSnippets(): string[] {
  return [...source.matchAll(/^\s+snippet: `([\s\S]*?)`,$/gm)]
    .map((match) => match[1])
    .filter((body) => body.trim().startsWith("{"));
}

/**
 * The subset of opencode's published config schema that matters here, from
 * https://opencode.ai/config.json (`$defs.McpRemoteConfig`): `mcp` is a map of
 * server name to config, and a remote config accepts only these keys.
 */
const OPENCODE_MCP_ENTRY_KEYS = new Set([
  "type",
  "url",
  "enabled",
  "headers",
  "oauth",
  "timeout",
]);

function isValidOpencodeMcpEntry(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (entry.type === "remote") {
    return (
      typeof entry.url === "string" &&
      Object.keys(entry).every((key) => OPENCODE_MCP_ENTRY_KEYS.has(key))
    );
  }
  if (entry.type === "local") return true;
  // The third branch the schema allows is a bare { enabled: boolean }.
  const keys = Object.keys(entry);
  return keys.length === 1 && typeof entry.enabled === "boolean";
}

describe("agent dashboard config snippets", () => {
  it("exposes one tab per client, each with a snippet", () => {
    const ids = [...source.matchAll(/^\s+id: "([a-z-]+)",$/gm)].map((m) => m[1]);
    expect(ids).toEqual([
      "opencode",
      "claude-code",
      "browser-signin",
      "generic",
      "openai",
    ]);
    // Five panels: opencode, claude-code, browser-signin, generic, openai.
    // The Claude Code one is a shell command, so it is not valid JSON.
    expect(jsonSnippets()).toHaveLength(4);
  });

  it("renders every snippet as valid JSON", () => {
    const snippets = jsonSnippets();
    expect(snippets.length).toBeGreaterThan(0);
    for (const snippet of snippets) {
      expect(() => JSON.parse(snippet), `invalid JSON:\n${snippet}`).not.toThrow();
    }
  });

  it("uses opencode's real shape: mcp maps a server name straight to its config", () => {
    // Regression: the snippet nested the server under mcp.servers, which is not
    // a key the schema defines. McpRemoteConfig sets additionalProperties:false,
    // so `servers` failed validation and the config would never connect.
    const opencode = jsonSnippets().find((snippet) => snippet.includes("opencode.ai/config.json"));
    expect(opencode).toBeDefined();

    const parsed = JSON.parse(opencode as string) as { mcp: Record<string, unknown> };
    expect(Object.keys(parsed.mcp)).toEqual(["html-docs"]);
    expect(parsed.mcp).not.toHaveProperty("servers");
    expect(isValidOpencodeMcpEntry(parsed.mcp["html-docs"])).toBe(true);
  });

  it("marks the OpenCode entry enabled, since a pasted token cannot auto-detect OAuth", () => {
    const opencode = JSON.parse(
      jsonSnippets().find((snippet) => snippet.includes("opencode.ai/config.json")) as string,
    ) as { mcp: Record<string, { enabled?: boolean; oauth?: unknown }> };
    expect(opencode.mcp["html-docs"].enabled).toBe(true);
    expect(opencode.mcp["html-docs"].oauth).toBe(false);
  });

  it("derives the endpoint from the loader instead of hardcoding a host", () => {
    // It used to hardcode https://html-docs-pink.vercel.app/mcp, so every copied
    // config pointed at a preview deployment regardless of where it was pasted.
    expect(source).not.toMatch(/https:\/\/html-docs-pink\.vercel\.app/);
    expect(source).toMatch(/mcpEndpoint: resourceIdentifier\(/);
    // The snippets interpolate the endpoint passed into clientPanels().
    expect(source).toContain("function clientPanels(endpoint: string)");
    expect(source).toContain("const panels = clientPanels(mcpEndpoint)");
    const interpolated = [...source.matchAll(/\$\{endpoint\}/g)];
    expect(interpolated.length).toBe(5);
  });

  it("tells Claude Code users that a url without a type is read as stdio", () => {
    expect(source).toMatch(/read as a stdio server/);
    expect(source).toMatch(/claude mcp add --transport http/);
  });

  it("documents OpenAI's authorization value rather than a header", () => {
    // OpenAI takes the credential as `authorization` in the request body. A
    // headers block here would be silently ignored.
    const openai = jsonSnippets().find((snippet) => snippet.includes('"server_label"'));
    expect(openai).toBeDefined();
    const parsed = JSON.parse(openai as string) as { tools: Array<Record<string, unknown>> };
    expect(parsed.tools[0].authorization).toMatch(/^hdo_/);
    expect(parsed.tools[0]).not.toHaveProperty("headers");
    expect(parsed.tools[0].require_approval).toBe("always");
  });

  it("offers browser sign-in as its own tab, and keeps type http in the generic form", () => {
    expect(source).toMatch(/id: "browser-signin"/);
    expect(source).toContain("No token needed");

    const snippets = jsonSnippets();
    // The tokenless browser-sign-in snippet: a url and a type, no credentials.
    const tokenless = snippets.find(
      (snippet) => snippet.includes("mcpServers") && !snippet.includes("Authorization"),
    );
    expect(tokenless).toBeDefined();
    expect(JSON.parse(tokenless as string).mcpServers["html-docs"].type).toBe("http");
  });

  it("mentions the opencode discovery endpoint now that the app serves it", () => {
    expect(source).toMatch(/\/\.well-known\/opencode/);
  });
});

describe("agent dashboard client tabs", () => {
  it("implements the ARIA tab pattern with roving focus", () => {
    // A tablist that does not drive aria-selected / aria-controls, or that leaves
    // every tab in the tab order, breaks both screen readers and arrow keys.
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tab"');
    expect(source).toContain('role="tabpanel"');
    expect(source).toContain("aria-selected={selected}");
    expect(source).toContain("aria-controls=");
    expect(source).toContain("aria-labelledby=");
    // Exactly one tab is in the tab order at a time.
    expect(source).toContain("tabIndex={selected ? 0 : -1}");
  });

  it("moves focus with arrow, Home, and End keys", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      expect(source).toContain(`"${key}"`);
    }
    // preventDefault stops the page from scrolling under the moving focus.
    expect(source).toContain("event.preventDefault()");
    expect(source).toMatch(/tabRefs\.current\[panels\[next\]\.id\]\?\.focus\(\)/);
  });

  it("hides inactive panels with the hidden attribute, not just styling", () => {
    // display:none alone leaves the panel reachable by screen reader.
    expect(source).toContain("hidden={panel.id !== activeClient}");
  });

  it("gives every panel a stable, id-derived tab relationship", () => {
    expect(source).toContain("const tablistId = useId()");
    expect(source).toContain("id={`${tablistId}-tab-${panel.id}`}");
    expect(source).toContain("id={`${tablistId}-panel-${panel.id}`}");
  });

  it("keeps notes as a list so they read as separate points", () => {
    expect(source).toMatch(/<ul className="mt-3 space-y-1\.5 text-xs">/);
    // A bullet drawn with a character would be read aloud as punctuation.
    expect(source).not.toMatch(/<li[^>]*>[•·▪-]\s/);
  });

  it("themes the token panel for dark mode", () => {
    // bg-amber-50 is a light surface; without dark: overrides the whole panel
    // stayed near-white against the dark canvas.
    expect(source).toMatch(/bg-amber-50[\s\S]{0,200}dark:bg-amber-950\/30/);
    expect(source).toContain("dark:text-amber-100");
  });
});