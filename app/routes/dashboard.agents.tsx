import { useId, useRef, useState } from "react";
import { Form, Link, useActionData, useLoaderData } from "react-router";
import type { Route } from "./+types/dashboard.agents";
import { requireUserId } from "~/lib/auth.server";
import { isDesktopRuntime } from "~/lib/runtime.server";
import {
  createAgentToken,
  listAgentTokens,
  normalizeAgentScopes,
  revokeAgentToken,
  type AgentScope,
} from "~/lib/agent-tokens.server";
import { findOwnedGrantClient, listUserOAuthGrants, revokeClientGrants } from "~/lib/oauth.server";
import { resourceIdentifier } from "~/lib/mcp-resource.server";

const SCOPE_OPTIONS: Array<{ scope: AgentScope; label: string; hint: string }> = [
  { scope: "docs:read", label: "Read", hint: "List, search, and read documents and tabs" },
  { scope: "docs:write", label: "Write", hint: "Create documents and update titles and tabs" },
  { scope: "docs:delete", label: "Delete", hint: "Permanently delete documents" },
];

export const meta: Route.MetaFunction = () => [{ title: "Agent access — html-docs" }];

export async function loader(_args: Route.LoaderArgs) {
  if (isDesktopRuntime()) throw new Response("Not found", { status: 404 });
  const userId = await requireUserId(_args.request);
  const [tokens, grants] = await Promise.all([
    listAgentTokens(userId),
    listUserOAuthGrants(userId),
  ]);
  return {
    tokens,
    grants,
    // The snippets below are generated from the real resource identifier, so a
    // copied config cannot point a client at a host this deployment does not
    // serve. This used to be a hardcoded preview URL.
    mcpEndpoint: resourceIdentifier(_args.request),
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (isDesktopRuntime()) throw new Response("Not found", { status: 404 });
  const userId = await requireUserId(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "create") {
    const name = String(formData.get("name") ?? "").trim();
    const scopes = normalizeAgentScopes(formData.getAll("scopes"));
    const result = await createAgentToken(userId, name, scopes);
    return { created: result.summary, token: result.token };
  }

  if (intent === "revoke") {
    const tokenId = String(formData.get("tokenId") ?? "");
    await revokeAgentToken(userId, tokenId);
    return { revoked: true };
  }

  if (intent === "revoke-grant") {
    const grantId = String(formData.get("grantId") ?? "").trim();
    if (grantId) {
      // Scoped to the signed-in user, so a forged id cannot revoke someone
      // else's authorization.
      const clientPk = await findOwnedGrantClient(userId, grantId);
      if (clientPk) await revokeClientGrants(userId, clientPk);
    }
    return { revokedGrant: true };
  }

  return { error: "Invalid agent action" };
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

type ClientId = "opencode" | "claude-code" | "browser-signin" | "generic" | "openai";

interface ClientPanel {
  id: ClientId;
  label: string;
  /** Shown under the tab, before the snippet. */
  blurb: string;
  /** Language tag on the code block. */
  language: string;
  snippet: string;
  /** Short follow-up notes, rendered as a list when present. */
  notes?: string[];
}

function clientPanels(endpoint: string): ClientPanel[] {
  return [
    {
      id: "opencode",
      label: "OpenCode",
      blurb: "Add this to opencode.json, then set the token in your shell before starting OpenCode.",
      language: "json",
      snippet: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "html-docs": {
      "type": "remote",
      "url": "${endpoint}",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:HTML_DOCS_MCP_TOKEN}"
      }
    }
  }
}`,
      notes: [
        "Set HTML_DOCS_MCP_TOKEN in the environment, restart OpenCode, then run opencode mcp list.",
        "OpenCode also discovers this server on its own from /.well-known/opencode. Enable the html-docs entry there instead if you would rather sign in through the browser and skip the token.",
      ],
    },
    {
      id: "claude-code",
      label: "Claude Code",
      blurb: "Set the token in your shell first, then run this.",
      language: "bash",
      snippet: `claude mcp add --transport http html-docs ${endpoint} \\
  --header "Authorization: Bearer $HTML_DOCS_MCP_TOKEN"`,
      notes: [
        'Keep "type": "http" if you write the JSON form instead. An entry with a url and no type is read as a stdio server and skipped.',
        "Add --scope project to share it with your team, or --scope user to make it available in every project.",
      ],
    },
    {
      id: "browser-signin",
      label: "Browser sign-in",
      blurb:
        "No token needed. The client discovers the authorization server, registers itself, and asks you to approve access in the browser.",
      language: "json",
      snippet: `{
  "mcpServers": {
    "html-docs": {
      "type": "http",
      "url": "${endpoint}"
    }
  }
}`,
      notes: [
        "Access tokens expire after an hour and refresh on their own, so this stays connected without a pasted credential.",
      ],
    },
    {
      id: "generic",
      label: "Other clients",
      blurb: "Paste the token shown above in place of the placeholder.",
      language: "json",
      snippet: `{
  "mcpServers": {
    "html-docs": {
      "type": "http",
      "url": "${endpoint}",
      "headers": {
        "Authorization": "Bearer hdo_<paste-token>"
      }
    }
  }
}`,
      notes: [
        'The "type": "http" field matters: several clients read a url with no type as a stdio server.',
      ],
    },
    {
      id: "openai",
      label: "OpenAI",
      blurb:
        "The server goes in the request body, and the credential is an authorization value rather than a header.",
      language: "json",
      snippet: `{
  "tools": [{
    "type": "mcp",
    "server_label": "html_docs",
    "server_url": "${endpoint}",
    "authorization": "hdo_<paste-token>",
    "require_approval": "always",
    "allowed_tools": ["whoami", "list_documents", "get_document", "get_tab"]
  }],
  "input": "Summarize my most recent document"
}`,
      notes: [
        "OpenAI does not store the authorization value, so send it on every request.",
        "allowed_tools lists read-only tools here. Widening it also lets the model edit or delete your documents.",
      ],
    },
  ];
}

export default function DashboardAgents() {
  const { tokens, grants, mcpEndpoint } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [copied, setCopied] = useState(false);
  const createdToken = actionData && "token" in actionData ? actionData.token : null;

  const panels = clientPanels(mcpEndpoint);
  const [activeClient, setActiveClient] = useState<ClientId>(panels[0].id);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tablistId = useId();

  async function copyToken() {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  /** Roving focus: arrows move between tabs, Home/End jump to the ends. */
  function onTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = panels.findIndex((panel) => panel.id === activeClient);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % panels.length;
    if (event.key === "ArrowLeft") next = (index - 1 + panels.length) % panels.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = panels.length - 1;
    setActiveClient(panels[next].id);
    tabRefs.current[panels[next].id]?.focus();
  }

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <nav className="backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-10 border-b bg-canvas/85 border-hairline">
        <Link to="/dashboard" className="text-sm font-semibold text-primary">
          ← Back to documents
        </Link>
        <span className="text-xs text-subtle">html-docs agent access</span>
      </nav>

      <div className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Agent access</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Create a token for an AI agent to connect to the html-docs MCP server. Grant only the
          scopes the agent needs. Tokens are shown once and can be revoked at any time.
        </p>

        <div className="mt-8 rounded-xl border border-hairline bg-paper p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Create a token</h2>
          <Form method="post" className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="intent" value="create" />
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">Token name</span>
              <input
                name="name"
                required
                maxLength={100}
                placeholder="Claude Desktop"
                className="w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>

            <fieldset>
              <legend className="mb-2 text-xs font-medium text-muted">Permissions</legend>
              <div className="flex flex-col gap-2 sm:flex-row">
                {SCOPE_OPTIONS.map((option) => (
                  <label
                    key={option.scope}
                    className="flex flex-1 cursor-pointer items-start gap-2 rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm hover:border-primary"
                  >
                    <input
                      type="checkbox"
                      name="scopes"
                      value={option.scope}
                      defaultChecked={option.scope === "docs:read"}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block font-medium">{option.label}</span>
                      <span className="block text-xs text-muted">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <button
              type="submit"
              className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
            >
              Create token
            </button>
          </Form>
        </div>

        {createdToken && (
          <div className="mt-6 overflow-hidden rounded-xl border border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="p-5">
              <h2 className="font-semibold">Copy this token now</h2>
              <p className="mt-1 text-sm">It will not be shown again.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-ink dark:border-amber-800/70 dark:bg-card">
                  {createdToken}
                </code>
                <button
                  type="button"
                  onClick={copyToken}
                  className="shrink-0 rounded-lg border border-amber-400 px-3 py-2 text-sm font-medium transition-colors hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/40"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="border-t border-amber-300/70 px-5 pb-5 dark:border-amber-800/70">
              <div
                role="tablist"
                aria-label="Client configuration"
                onKeyDown={onTabKeyDown}
                className="-mb-px flex flex-wrap gap-x-1 overflow-x-auto"
              >
                {panels.map((panel) => {
                  const selected = panel.id === activeClient;
                  return (
                    <button
                      key={panel.id}
                      ref={(node) => {
                        tabRefs.current[panel.id] = node;
                      }}
                      type="button"
                      role="tab"
                      id={`${tablistId}-tab-${panel.id}`}
                      aria-selected={selected}
                      aria-controls={`${tablistId}-panel-${panel.id}`}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setActiveClient(panel.id)}
                      className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:focus-visible:outline-amber-400 ${
                        selected
                          ? "border-amber-600 text-amber-950 dark:border-amber-400 dark:text-amber-50"
                          : "border-transparent text-amber-800/70 hover:border-amber-400/60 hover:text-amber-900 dark:text-amber-200/70 dark:hover:text-amber-50"
                      }`}
                    >
                      {panel.label}
                    </button>
                  );
                })}
              </div>

              {panels.map((panel) => (
                <div
                  key={panel.id}
                  role="tabpanel"
                  id={`${tablistId}-panel-${panel.id}`}
                  aria-labelledby={`${tablistId}-tab-${panel.id}`}
                  hidden={panel.id !== activeClient}
                  tabIndex={0}
                  className="pt-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:focus-visible:outline-amber-400"
                >
                  <p className="text-xs">{panel.blurb}</p>
                  <div className="mt-2 overflow-hidden rounded-lg border border-amber-300/70 bg-white dark:border-amber-800/70 dark:bg-card">
                    <div className="flex items-center justify-between border-b border-amber-200/70 px-3 py-1.5 dark:border-amber-800/50">
                      <span className="font-mono text-[10px] uppercase tracking-wide text-amber-800/70 dark:text-amber-200/60">
                        {panel.language}
                      </span>
                    </div>
                    <pre className="overflow-x-auto p-3 text-xs text-ink dark:text-amber-50">
                      <code>{panel.snippet}</code>
                    </pre>
                  </div>
                  {panel.notes && (
                    <ul className="mt-3 space-y-1.5 text-xs">
                      {panel.notes.map((note) => (
                        <li key={note} className="flex gap-2">
                          <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Your tokens</h2>
          {tokens.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-hairline bg-surface p-6 text-sm text-muted">
              No agent tokens yet.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {tokens.map((token) => {
                const inactive = Boolean(token.revokedAt) || Boolean(token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now());
                return (
                  <div key={token.id} className="flex flex-col gap-3 rounded-xl border border-hairline bg-paper p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{token.name}</p>
                      <p className="mt-1 font-mono text-xs text-subtle">{token.tokenPrefix}••••••••</p>
                      <p className="mt-1 text-xs text-muted">
                        {token.scopes.join(", ")} · Created {formatDate(token.createdAt)} · Last used {formatDate(token.lastUsedAt)}
                      </p>
                    </div>
                    {inactive ? (
                      <span className="text-xs font-medium text-subtle">Inactive</span>
                    ) : (
                      <Form method="post">
                        <input type="hidden" name="intent" value="revoke" />
                        <input type="hidden" name="tokenId" value={token.id} />
                        <button
                          type="submit"
                          className="rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                        >
                          Revoke
                        </button>
                      </Form>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Connected OAuth clients</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Clients that signed in through the browser authorization flow appear here. Revoking
            one immediately invalidates its access and refresh tokens.
          </p>
          {grants.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-hairline bg-surface p-6 text-sm text-muted">
              No OAuth clients have connected yet.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {grants.map((grant) => {
                const inactive = Boolean(grant.revokedAt);
                return (
                  <div
                    key={grant.id}
                    className="flex flex-col gap-3 rounded-xl border border-hairline bg-paper p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{grant.clientName}</p>
                      <p className="mt-1 text-xs text-muted">
                        {grant.scope} · Connected {formatDate(grant.createdAt)}
                      </p>
                    </div>
                    {inactive ? (
                      <span className="text-xs font-medium text-subtle">Revoked</span>
                    ) : (
                      <Form method="post">
                        <input type="hidden" name="intent" value="revoke-grant" />
                        <input type="hidden" name="grantId" value={grant.id} />
                        <button
                          type="submit"
                          className="rounded-lg border border-red-300 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                        >
                          Revoke
                        </button>
                      </Form>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
