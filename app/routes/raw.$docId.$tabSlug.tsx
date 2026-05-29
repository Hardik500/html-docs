import type { Route } from "./+types/raw.$docId.$tabSlug";
import { query } from "~/lib/db.server";
import { rawResponseHeaders } from "~/lib/csp.server";

export async function loader({ params }: Route.LoaderArgs) {
  const { docId, tabSlug } = params;

  const result = await query<{ html: string }>(
    "SELECT html FROM tabs WHERE doc_id = $1 AND slug = $2",
    [docId, tabSlug]
  );

  if (!result.rows.length) {
    throw new Response("Not Found", { status: 404 });
  }

  const { html } = result.rows[0];

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...rawResponseHeaders(),
    },
  });
}
