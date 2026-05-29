import { redirect } from "react-router";
import type { Route } from "./+types/dashboard.docs.$id.rename";
import { query } from "~/lib/db.server";
import { requireUserId } from "~/lib/auth.server";

export async function action({ params, request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const { id } = params;

  // Verify ownership
  const result = await query<{ owner_user_id: string | null; title: string }>(
    "SELECT owner_user_id, title FROM docs WHERE id = $1",
    [id]
  );

  if (!result.rows.length || result.rows[0].owner_user_id !== userId) {
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  let title = String(formData.get("title") ?? "").trim().slice(0, 500);

  // If submitted as form without title field (from dashboard button),
  // prompt via the response — but since we're server-side, use existing title
  if (!title) {
    title = result.rows[0].title;
  }

  await query(
    "UPDATE docs SET title = $1, last_activity_at = now() WHERE id = $2",
    [title, id]
  );

  return redirect("/dashboard");
}

export function loader() {
  return redirect("/dashboard");
}
