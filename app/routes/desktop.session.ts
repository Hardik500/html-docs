import type { Route } from "./+types/desktop.session";
import { getUser } from "~/lib/auth.server";
import { isDesktopRuntime } from "~/lib/runtime.server";

export async function loader({ request }: Route.LoaderArgs) {
  if (isDesktopRuntime()) {
    throw new Response("Hosted desktop session lookup is not available from the local runtime", {
      status: 501,
    });
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer dhd_")) {
    throw new Response("Desktop session token is required", { status: 401 });
  }

  const user = await getUser(request);
  if (!user) throw new Response("Unauthorized", { status: 401 });

  return Response.json(
    { userId: user.id, email: user.email },
    { headers: { "Cache-Control": "no-store" } },
  );
}
