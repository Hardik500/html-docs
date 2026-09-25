import type { Route } from "./+types/oauth.token";
import { isDesktopRuntime } from "~/lib/runtime.server";
import {
  OAuthError,
  exchangeAuthorizationCode,
  formatScope,
  refreshAccessToken,
  resourceIdentifier,
} from "~/lib/oauth.server";

/** OAuth 2.1 token endpoint. Public clients only, so no client authentication. */
export async function action({ request }: Route.ActionArgs) {
  if (isDesktopRuntime()) throw new Response("Not found", { status: 404 });

  const contentType = request.headers.get("content-type") ?? "";
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(
      contentType.includes("application/json")
        ? JSON.stringify(Object.fromEntries(await request.json().catch(() => ({}))))
        : await request.text(),
    );
  } catch {
    return tokenError(new OAuthError("invalid_request", "Malformed token request"));
  }

  try {
    const grantType = params.get("grant_type");
    if (grantType === "authorization_code") {
      const grant = await exchangeAuthorizationCode({
        code: params.get("code"),
        codeVerifier: params.get("code_verifier"),
        clientId: params.get("client_id"),
        redirectUri: params.get("redirect_uri"),
        resource: resourceIdentifier(request),
      });
      return Response.json(
        {
          access_token: grant.accessToken,
          token_type: "Bearer",
          expires_in: grant.expiresIn,
          refresh_token: grant.refreshToken,
          scope: formatScope(grant.scopes),
        },
        { headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } },
      );
    }

    if (grantType === "refresh_token") {
      const grant = await refreshAccessToken({
        refreshToken: params.get("refresh_token"),
        clientId: params.get("client_id"),
        resource: resourceIdentifier(request),
      });
      return Response.json(
        {
          access_token: grant.accessToken,
          token_type: "Bearer",
          expires_in: grant.expiresIn,
          refresh_token: grant.refreshToken,
          scope: formatScope(grant.scopes),
        },
        { headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } },
      );
    }

    return tokenError(new OAuthError("unsupported_grant_type", "Unsupported grant_type", 400));
  } catch (error) {
    if (error instanceof OAuthError) return tokenError(error);
    throw error;
  }
}

/** RFC 6749: errors at the token endpoint must not redirect. */
function tokenError(error: OAuthError): Response {
  return Response.json(
    { error: error.errorCode, error_description: error.message },
    { status: error.status, headers: { "Cache-Control": "no-store" } },
  );
}

export function loader() {
  return Response.json(
    { error: "invalid_request", error_description: "Use POST to redeem a grant" },
    { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
  );
}
