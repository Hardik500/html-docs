import { redirect } from "react-router";
import type { Route } from "./+types/dashboard.docs.$id.rename";
import { withTransaction } from "~/lib/db.server";
import { requireUserId } from "~/lib/auth.server";
import { markLocalDocumentDirty, recordDocumentChange } from "~/lib/sync.server";

export async function action({ params, request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const { id } = params;
  const formData = await request.formData();
  const requestedTitle = String(formData.get("title") ?? "")
    .trim()
    .slice(0, 500);

  const result = await withTransaction(async (runQuery) => {
    const current = await runQuery<{ owner_user_id: string | null; title: string }>(
      `SELECT owner_user_id, title
         FROM docs
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE`,
      [id],
    );
    if (!current.rows.length || current.rows[0].owner_user_id !== userId) {
      return { ok: false as const };
    }

    const title = requestedTitle || current.rows[0].title;
    await runQuery(
      "UPDATE docs SET title = $1, last_activity_at = now() WHERE id = $2",
      [title, id],
    );
    await recordDocumentChange(runQuery, id, userId);
    await markLocalDocumentDirty(id, false, runQuery);
    return { ok: true as const };
  });

  if (!result.ok) throw new Response("Forbidden", { status: 403 });
  return redirect("/dashboard");
}

export function loader() {
  return redirect("/dashboard");
}
