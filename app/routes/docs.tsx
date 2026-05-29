import { redirect } from "react-router";
import type { Route } from "./+types/docs";
import { query } from "~/lib/db.server";
import { newDocId, newTabId, newEditToken } from "~/lib/ids";
import { slugify } from "~/lib/slug";
import { extractTitle } from "~/lib/titleExtract";
import { checkAnonCreateRate } from "~/lib/ratelimit.server";
import { getUserId } from "~/lib/auth.server";

const MAX_HTML_BYTES = 1_048_576;

function getClientIp(request: Request): string {
  return (
    request.headers.get("fly-client-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown"
  );
}

export async function loader() {
  return redirect("/");
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_100_000) throw new Response("Payload too large", { status: 413 });

  const userId = await getUserId(request);

  // Rate-limit anonymous users
  if (!userId) {
    const ip = getClientIp(request);
    const allowed = await checkAnonCreateRate(ip);
    if (!allowed) {
      throw new Response("Rate limit exceeded. Try again tomorrow.", {
        status: 429,
      });
    }
  }

  const formData = await request.formData();
  let html = String(formData.get("html") ?? "").trim();
  const titleInput = String(formData.get("title") ?? "").trim();

  if (!html) {
    html = `<!DOCTYPE html>\n<html>\n<head>\n  <title>Untitled Document</title>\n</head>\n<body>\n  \n</body>\n</html>`;
  }
  if (new TextEncoder().encode(html).length > MAX_HTML_BYTES) {
    throw new Response("HTML exceeds 1 MB limit", { status: 413 });
  }

  const docId = newDocId();
  const editToken = newEditToken();
  const tabId = newTabId();

  const tabName = (titleInput || extractTitle(html, "Tab 1")).slice(0, 500);
  const docTitle = (titleInput || tabName).slice(0, 500);
  const slug = slugify(tabName) || "tab-1";

  await query(
    `INSERT INTO docs (id, title, owner_user_id, edit_token)
     VALUES ($1, $2, $3, $4)`,
    [docId, docTitle, userId ?? null, editToken]
  );

  await query(
    `INSERT INTO tabs (id, doc_id, slug, name, position, html)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tabId, docId, slug, tabName, 0, html]
  );

  // Set anon edit cookie (scoped to this doc)
  const headers = new Headers();
  if (!userId) {
    const isSecure = process.env.NODE_ENV === "production";
    headers.append(
      "Set-Cookie",
      `anon_edit_${docId}=${editToken}; Path=/d/${docId}; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}${isSecure ? "; Secure" : ""}`
    );
  }

  const editUrl = `/d/${docId}/edit`;
  headers.append("Location", editUrl);

  return new Response(null, { status: 302, headers });
}
