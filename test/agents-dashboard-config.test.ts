import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(REPO, "app/routes/dashboard.agents.tsx"), "utf8");

/** Every `{`...`}` template literal in the file is a JSON snippet shown to a user. */
function jsonSnippets(): string[] {
  return [...source.matchAll(/\{`([\s\S]*?)`\}/g)]
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
    expect(source).toContain('"url": "${mcpEndpoint}"');
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

  it("points at the browser sign-in path for clients that support it", () => {
    expect(source).toMatch(/browser sign-in \(no token needed\)/);
    // A url with no type is skipped by Claude Code, so the generic block keeps it.
    const generic = jsonSnippets().find((snippet) => snippet.includes("mcpServers") && !snippet.includes("Authorization"));
    expect(generic).toBeDefined();
    expect(JSON.parse(generic as string).mcpServers["html-docs"].type).toBe("http");
  });

  it("mentions the opencode discovery endpoint now that the app serves it", () => {
    expect(source).toMatch(/\/\.well-known\/opencode/);
  });
});