import { redirect } from "react-router";
import type { Route } from "./+types/dashboard.docs.$id.delete";
import { query } from "~/lib/db.server";
import { requireUserId } from "~/lib/auth.server";

export async function action({ params, request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const { id } = params;

  // Verify ownership
  const result = await query<{ owner_user_id: string | null }>(
    "SELECT owner_user_id FROM docs WHERE id = $1",
    [id]
  );

  if (!result.rows.length || result.rows[0].owner_user_id !== userId) {
    throw new Response("Forbidden", { status: 403 });
  }

  await query("DELETE FROM docs WHERE id = $1", [id]);

  return redirect("/dashboard");
}

export function loader() {
  return redirect("/dashboard");
}
