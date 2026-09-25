import { redirect } from "react-router";
import type { Route } from "./+types/auth.claim";
import { withTransaction } from "~/lib/db.server";
import { requireUserId } from "~/lib/auth.server";
import { newEditToken } from "~/lib/ids";
import { markLocalDocumentDirty, recordDocumentChange } from "~/lib/sync.server";

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  // editToken comes from the page's loader data (JS heap) — never from a URL.
  const body = await request.json() as { docId: string; editToken: string };
  const { docId, editToken } = body;

  if (!docId || !editToken) {
    throw new Response("docId and editToken are required", { status: 400 });
  }

  const newToken = newEditToken();
  const result = await withTransaction(async (runQuery) => {
    const current = await runQuery<{
      owner_user_id: string | null;
      edit_token: string;
    }>(
      `SELECT owner_user_id, edit_token
         FROM docs
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE`,
      [docId],
    );
    if (!current.rows.length) return { kind: "not-found" as const };
    const doc = current.rows[0];
    if (doc.owner_user_id) return { kind: "owned" as const };
    if (doc.edit_token !== editToken) return { kind: "forbidden" as const };

    await runQuery(
      "UPDATE docs SET owner_user_id = $1, edit_token = $2, last_activity_at = now() WHERE id = $3",
      [userId, newToken, docId],
    );
    await recordDocumentChange(runQuery, docId, userId);
    await markLocalDocumentDirty(docId, false, runQuery);
    return { kind: "ok" as const };
  });

  if (result.kind === "not-found") {
    throw new Response("Document not found", { status: 404 });
  }
  if (result.kind === "owned") {
    throw new Response("Document already has an owner", { status: 409 });
  }
  if (result.kind === "forbidden") {
    throw new Response("Invalid edit token", { status: 403 });
  }

  return { ok: true, editToken: newToken };
}

// No GET — only POST
export function loader() {
  return redirect("/");
}
