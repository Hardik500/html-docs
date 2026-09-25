import { Form, Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/oauth.authorize";
import { getUserId } from "~/lib/auth.server";
import { isDesktopRuntime } from "~/lib/runtime.server";
import { OAuthError, issueAuthorizationCode, validateAuthorizeRequest } from "~/lib/oauth.server";
import type { AgentScope } from "~/lib/agent-tokens.server";

const SCOPE_LABELS: Record<AgentScope, { title: string; detail: string }> = {
  "docs:read": { title: "Read your documents", detail: "List, search, and read documents and tabs you own." },
  "docs:write": { title: "Create and edit documents", detail: "Add documents and change their titles and tab content." },
  "docs:delete": { title: "Delete documents", detail: "Permanently delete documents you own." },
};

/** Builds the RFC 6749 error redirect, or renders the error directly. */
function authorizeError(error: unknown): Response {
  if (!(error instanceof OAuthError)) throw error;
  if (error.redirectUri) {
    const url = new URL(error.redirectUri);
    url.searchParams.set("error", error.errorCode);
    if (error.state) url.searchParams.set("state", error.state);
    if (error.errorCode !== "invalid_request") {
      url.searchParams.set("error_description", error.message);
    }
    return redirect(url.toString());
  }
  throw new Response(error.message, { status: error.status });
}

export async function loader({ request }: Route.LoaderArgs) {
  if (isDesktopRuntime()) throw new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const params = url.searchParams;

  let pending: Awaited<ReturnType<typeof validateAuthorizeRequest>>;
  try {
    pending = await validateAuthorizeRequest(params);
  } catch (error) {
    return authorizeError(error);
  }

  const userId = await getUserId(request);
  if (!userId) {
    // Preserve the full authorization request across the magic-link round trip.
    const signIn = new URL("/auth/magic", url.origin);
    signIn.searchParams.set("redirect", `${url.pathname}${url.search}`);
    return redirect(signIn.toString());
  }

  return {
    clientName: pending.client.client_name,
    clientId: pending.client.client_id,
    redirectUri: pending.redirectUri,
    scopes: pending.scopes,
    state: pending.state,
    codeChallenge: pending.codeChallenge,
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (isDesktopRuntime()) throw new Response("Not found", { status: 404 });

  const userId = await getUserId(request);
  if (!userId) throw new Response("Sign in to authorize this client", { status: 401 });

  const formData = await request.formData();
  const params = new URLSearchParams();
  for (const field of [
    "client_id",
    "redirect_uri",
    "state",
    "scope",
    "code_challenge",
    "code_challenge_method",
    "response_type",
  ]) {
    const value = formData.get(field);
    if (typeof value === "string") params.set(field, value);
  }

  if (formData.get("decision") !== "allow") {
    // Denial must still return to the client so it can stop waiting.
    const redirectUri = params.get("redirect_uri") ?? "";
    const state = params.get("state");
    let target: URL | null = null;
    try {
      const pending = await validateAuthorizeRequest(params);
      target = new URL(pending.redirectUri);
    } catch {
      target = null;
    }
    if (target) {
      target.searchParams.set("error", "access_denied");
      if (state) target.searchParams.set("state", state);
      return redirect(target.toString());
    }
    return authorizeError(new OAuthError("access_denied", "Authorization was denied", 400, redirectUri || null, state));
  }

  try {
    const pending = await validateAuthorizeRequest(params);
    const code = await issueAuthorizationCode(pending, userId);
    const target = new URL(pending.redirectUri);
    target.searchParams.set("code", code);
    if (pending.state) target.searchParams.set("state", pending.state);
    return redirect(target.toString());
  } catch (error) {
    return authorizeError(error);
  }
}

export default function OAuthAuthorize() {
  const data = useLoaderData<typeof loader>();
  const hidden = {
    client_id: data.clientId,
    redirect_uri: data.redirectUri,
    response_type: "code",
    scope: data.scopes.join(" "),
    code_challenge: data.codeChallenge,
    code_challenge_method: "S256",
    ...(data.state ? { state: data.state } : {}),
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-canvas text-ink">
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-bold">Authorize {data.clientName}</h1>
        <p className="mt-2 text-sm text-muted">
          This MCP client is asking for access to your html-docs account. It can only reach
          documents you own.
        </p>

        <ul className="mt-6 space-y-3">
          {data.scopes.map((scope) => (
            <li key={scope} className="rounded-lg border border-hairline bg-paper p-4">
              <p className="text-sm font-medium">{SCOPE_LABELS[scope].title}</p>
              <p className="mt-1 text-sm text-muted">{SCOPE_LABELS[scope].detail}</p>
            </li>
          ))}
        </ul>

        <Form method="post" className="mt-6 flex flex-col gap-3 sm:flex-row">
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <button
            type="submit"
            name="decision"
            value="deny"
            className="flex-1 rounded-lg border border-hairline px-4 py-2.5 text-sm font-medium hover:bg-canvas"
          >
            Deny
          </button>
          <button
            type="submit"
            name="decision"
            value="allow"
            className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-dark"
          >
            Allow access
          </button>
        </Form>

        <p className="mt-4 text-xs text-subtle">
          You can revoke this access at any time from{" "}
          <Link to="/dashboard/agents" className="text-primary underline">Dashboard → Agents</Link>.
        </p>
      </div>
    </main>
  );
}
