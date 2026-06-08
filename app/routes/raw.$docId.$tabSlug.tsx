import type { Route } from "./+types/raw.$docId.$tabSlug";
import { query } from "~/lib/db.server";
import { rawResponseHeaders } from "~/lib/csp.server";
import { injectDefaultStyles } from "~/lib/htmlDefaults";
import { markdownToHtml } from "~/lib/markdown";

export async function loader({ params }: Route.LoaderArgs) {
  const { docId, tabSlug } = params;

  const result = await query<{ html: string; content_type: string }>(
    "SELECT html, content_type FROM tabs WHERE doc_id = $1 AND slug = $2",
    [docId, tabSlug]
  );

  if (!result.rows.length) {
    throw new Response("Not Found", { status: 404 });
  }

  const { html, content_type } = result.rows[0];
  const document = content_type === "markdown" ? markdownToHtml(html) : html;

  return new Response(injectDefaultStyles(document), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...rawResponseHeaders(),
    },
  });
}
