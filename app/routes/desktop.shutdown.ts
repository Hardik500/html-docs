import type { Route } from "./+types/desktop.shutdown";
import { closeDatabase } from "~/lib/db.server";
import { isDesktopRuntime } from "~/lib/runtime.server";

export async function action({ request }: Route.ActionArgs) {
  if (!isDesktopRuntime()) {
    throw new Response("Not found", { status: 404 });
  }

  const token = process.env.HTML_DOCS_DESKTOP_TOKEN;
  if (!token || request.headers.get("x-html-docs-desktop-token") !== token) {
    throw new Response("Forbidden", { status: 403 });
  }

  await closeDatabase();
  return new Response(null, { status: 204 });
}

export function loader() {
  return new Response("Method not allowed", { status: 405 });
}
