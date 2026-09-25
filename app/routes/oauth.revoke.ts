import type { Route } from "./+types/oauth.revoke";
import { isDesktopRuntime } from "~/lib/runtime.server";
import { revokeToken } from "~/lib/oauth.server";

/** RFC 7009 token revocation. Always answers 200 so it cannot be used to probe tokens. */
export async function action({ request }: Route.ActionArgs) {
  if (isDesktopRuntime()) throw new Response("Not found", { status: 404 });

  const contentType = request.headers.get("content-type") ?? "";
  const params = new URLSearchParams(
    contentType.includes("application/json")
      ? JSON.stringify(Object.fromEntries(await request.json().catch(() => ({}))))
      : await request.text(),
  );

  await revokeToken(params.get("token")).catch(() => undefined);

  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export function loader() {
  return Response.json(
    { error: "invalid_request", error_description: "Use POST to revoke a token" },
    { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
  );
}
