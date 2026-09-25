import { useState } from "react";
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

const SCOPE_OPTIONS: Array<{ scope: AgentScope; label: string; hint: string }> = [
  { scope: "docs:read", label: "Read", hint: "List, search, and read documents and tabs" },
  { scope: "docs:write", label: "Write", hint: "Create documents and update titles and tabs" },
  { scope: "docs:delete", label: "Delete", hint: "Permanently delete documents" },
];

export const meta: Route.MetaFunction = () => [{ title: "Agent access — html-docs" }];

export async function loader(_args: Route.LoaderArgs) {
  if (isDesktopRuntime()) throw new Response("Not found", { status: 404 });
  const userId = await requireUserId(_args.request);
  return { tokens: await listAgentTokens(userId) };
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

  return { error: "Invalid agent action" };
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

export default function DashboardAgents() {
  const { tokens } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [copied, setCopied] = useState(false);
  const createdToken = actionData && "token" in actionData ? actionData.token : null;

  async function copyToken() {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
          <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
            <h2 className="font-semibold">Copy this token now</h2>
            <p className="mt-1 text-sm">It will not be shown again.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-xs">
                {createdToken}
              </code>
              <button
                type="button"
                onClick={copyToken}
                className="rounded-lg border border-amber-400 px-3 py-2 text-sm font-medium hover:bg-amber-100"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <div>
                <h3 className="font-semibold">OpenCode</h3>
                <p className="mt-1 text-xs">
                  Add this to your OpenCode configuration, then set the token in your shell before starting OpenCode.
                </p>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-white p-3 text-xs">
{`{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "html-docs": {
        "type": "remote",
        "url": "https://html-docs-pink.vercel.app/mcp",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer {env:HTML_DOCS_MCP_TOKEN}"
        }
      }
    }
  }
}`}
                </pre>
                <p className="mt-2 text-xs">
                  Set <code className="font-mono">HTML_DOCS_MCP_TOKEN</code> in the environment, restart OpenCode, and run <code className="font-mono">opencode mcp list</code>.
                </p>
              </div>
              <div>
                <h3 className="font-semibold">Other HTTP MCP clients</h3>
                <p className="mt-1 text-xs">Replace the placeholder with the token shown above.</p>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-white p-3 text-xs">
{`{
  "mcpServers": {
    "html-docs": {
      "type": "http",
      "url": "https://html-docs-pink.vercel.app/mcp",
      "headers": {
        "Authorization": "Bearer hdo_<paste-token>"
      }
    }
  }
}`}
                </pre>
              </div>
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
      </div>
    </main>
  );
}
