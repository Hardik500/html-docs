import type { Route } from "./+types/oauth.register";
import { isDesktopRuntime } from "~/lib/runtime.server";
import { OAuthError, registerClient } from "~/lib/oauth.server";

/** RFC 7591 dynamic client registration for public MCP clients. */
export async function action({ request }: Route.ActionArgs) {
  if (isDesktopRuntime()) throw new Response("Not found", { status: 404 });

  let body: { client_name?: unknown; redirect_uris?: unknown };
  try {
    body = await request.json();
  } catch {
    return oauthErrorResponse(new OAuthError("invalid_request", "Expected a JSON request body"));
  }

  try {
    const client = await registerClient({
      clientName: body.client_name,
      redirectUris: body.redirect_uris,
    });
    return Response.json(
      {
        client_id: client.clientId,
        client_id_issued_at: client.issuedAt,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof OAuthError) return oauthErrorResponse(error);
    throw error;
  }
}

function oauthErrorResponse(error: OAuthError): Response {
  return Response.json(
    { error: error.errorCode, error_description: error.message },
    { status: error.status, headers: { "Cache-Control": "no-store" } },
  );
}

export function loader() {
  return Response.json(
    { error: "invalid_request", error_description: "Use POST to register a client" },
    { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
  );
}
