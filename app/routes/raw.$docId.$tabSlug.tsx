import type { Route } from "./+types/raw.$docId.$tabSlug";
import { query } from "~/lib/db.server";
import { rawResponseHeaders } from "~/lib/csp.server";
import { injectDefaultStyles } from "~/lib/htmlDefaults";
import { markdownToHtml } from "~/lib/markdown";
import { docToHtml } from "~/lib/doc";

const PRINT_SCRIPT = `<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},150);});</script>`;

function injectPrintScript(html: string): string {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${PRINT_SCRIPT}</body>`);
  return html + "\n" + PRINT_SCRIPT;
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { docId, tabSlug } = params;
  const isPrint = new URL(request.url).searchParams.has("print");

  const result = await query<{ html: string; content_type: string }>(
    "SELECT html, content_type FROM tabs WHERE doc_id = $1 AND slug = $2",
    [docId, tabSlug]
  );

  if (!result.rows.length) {
    throw new Response("Not Found", { status: 404 });
  }

  const { html, content_type } = result.rows[0];

  if (content_type === "pdf") {
    // html column stores the raw base64 string for PDFs — decode to binary.
    const binary = Uint8Array.from(atob(html), (c) => c.charCodeAt(0));
    return new Response(binary, {
      status: 200,
      headers: { "Content-Type": "application/pdf" },
    });
  }

  const document =
    content_type === "markdown" ? markdownToHtml(html)
    : content_type === "doc"    ? docToHtml(html)
    : html;

  const withDefaults = injectDefaultStyles(document);
  const body = isPrint ? injectPrintScript(withDefaults) : withDefaults;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...rawResponseHeaders(),
    },
  });
}
