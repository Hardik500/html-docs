import type { Route } from "./+types/auth.logout";
import { destroyUserSession } from "~/lib/auth.server";

export async function action({ request }: Route.ActionArgs) {
  return destroyUserSession(request);
}

export async function loader() {
  return new Response(null, { status: 405 });
}
