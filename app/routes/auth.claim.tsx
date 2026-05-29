import { redirect } from "react-router";
import type { Route } from "./+types/auth.claim";
import { query } from "~/lib/db.server";
import { requireUserId } from "~/lib/auth.server";
import { newEditToken } from "~/lib/ids";

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const body = await request.json() as { docId: string; editToken: string };
  const { docId, editToken } = body;

  if (!docId || !editToken) {
    throw new Response("docId and editToken are required", { status: 400 });
  }

  const result = await query<{
    owner_user_id: string | null;
    edit_token: string;
  }>(
    "SELECT owner_user_id, edit_token FROM docs WHERE id = $1",
    [docId]
  );

  if (!result.rows.length) {
    throw new Response("Document not found", { status: 404 });
  }

  const doc = result.rows[0];

  if (doc.owner_user_id) {
    throw new Response("Document already has an owner", { status: 409 });
  }

  if (doc.edit_token !== editToken) {
    throw new Response("Invalid edit token", { status: 403 });
  }

  // Rotate edit token and set owner
  const newToken = newEditToken();
  await query(
    "UPDATE docs SET owner_user_id = $1, edit_token = $2, last_activity_at = now() WHERE id = $3",
    [userId, newToken, docId]
  );

  return { ok: true, editToken: newToken };
}

// No GET — only POST
export function loader() {
  return redirect("/");
}
