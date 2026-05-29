import { redirect } from "react-router";
import type { Route } from "./+types/d.$docId";
import { query } from "~/lib/db.server";

export async function loader({ params }: Route.LoaderArgs) {
  const { docId } = params;

  const result = await query<{ slug: string }>(
    "SELECT slug FROM tabs WHERE doc_id = $1 ORDER BY position ASC LIMIT 1",
    [docId]
  );

  if (!result.rows.length) {
    throw new Response("Document not found", { status: 404 });
  }

  return redirect(`/d/${docId}/${result.rows[0].slug}`);
}
