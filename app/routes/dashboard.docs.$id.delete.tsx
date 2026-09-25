import { redirect } from "react-router";
import type { Route } from "./+types/dashboard.docs.$id.delete";
import { withTransaction } from "~/lib/db.server";
import { requireUserId } from "~/lib/auth.server";
import { markLocalDocumentDirty, recordDocumentChange } from "~/lib/sync.server";

export async function action({ params, request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const { id } = params;

  const result = await withTransaction(async (runQuery) => {
    const current = await runQuery<{ owner_user_id: string | null }>(
      `SELECT owner_user_id
         FROM docs
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE`,
      [id],
    );
    if (!current.rows.length || current.rows[0].owner_user_id !== userId) {
      return { ok: false as const };
    }

    await runQuery(
      "UPDATE docs SET deleted_at = now(), last_activity_at = now() WHERE id = $1",
      [id],
    );
    await runQuery("DELETE FROM tabs WHERE doc_id = $1", [id]);
    await recordDocumentChange(runQuery, id, userId);
    await markLocalDocumentDirty(id, true, runQuery);
    return { ok: true as const };
  });

  if (!result.ok) throw new Response("Forbidden", { status: 403 });
  return redirect("/dashboard");
}

export function loader() {
  return redirect("/dashboard");
}
