import type { Route } from "./+types/download.$docId.$tabSlug";
import { query } from "~/lib/db.server";
import { markdownToHtml } from "~/lib/markdown";
import { docToHtml } from "~/lib/doc";
import { htmlToMarkdown } from "~/lib/htmlToMarkdown.server";

type DownloadFormat = "html" | "md" | "docx" | "pdf";

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "download";
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { docId, tabSlug } = params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") as DownloadFormat | null;

  if (!format || !["html", "md", "docx", "pdf"].includes(format)) {
    throw new Response("Invalid format. Use ?format=html|md|docx|pdf", { status: 400 });
  }

  const result = await query<{ html: string; content_type: string; name: string }>(
    "SELECT html, content_type, name FROM tabs WHERE doc_id = $1 AND slug = $2",
    [docId, tabSlug]
  );
  if (!result.rows.length) throw new Response("Not Found", { status: 404 });

  const { html: stored, content_type, name } = result.rows[0];
  const baseName = sanitizeFilename(name);

  // PDF source tab
  if (content_type === "pdf") {
    if (format !== "pdf") {
      throw new Response("PDF tabs can only be downloaded as PDF", { status: 400 });
    }
    const binary = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    return new Response(binary, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  // Non-PDF → PDF: client must use print dialog
  if (format === "pdf") {
    throw new Response("Use print dialog: /raw/:docId/:tabSlug?print=1", { status: 400 });
  }

  // Resolve intermediate HTML
  const htmlDoc: string =
    content_type === "markdown" ? markdownToHtml(stored)
    : content_type === "doc"    ? docToHtml(stored)
    : stored;

  if (format === "html") {
    return new Response(htmlDoc, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.html"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (format === "md") {
    const mdContent = content_type === "markdown" ? stored : htmlToMarkdown(htmlDoc);
    return new Response(mdContent, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.md"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (format === "docx") {
    const htmlToDocx = (await import("html-to-docx")).default;
    const docxBuffer = await htmlToDocx(htmlDoc, undefined, {
      table: { row: { cantSplit: true } },
      footer: false,
      pageNumber: false,
    });
    return new Response(docxBuffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${baseName}.docx"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  throw new Response("Unhandled format", { status: 500 });
}
