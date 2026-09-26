import type { Route } from "./+types/thumb.$docId.$tabSlug";
import { query } from "~/lib/db.server";
import { getUser } from "~/lib/auth.server";
import { rawResponseHeaders } from "~/lib/csp.server";
import { injectDefaultStyles } from "~/lib/htmlDefaults";
import { injectPreviewCsp } from "~/lib/preview-csp";
import { markdownToHtml } from "~/lib/markdown";
import { docToHtml } from "~/lib/doc";

/**
 * Dashboard thumbnail for one document's first tab.
 *
 * This exists so the dashboard does not have to inline preview HTML into its own
 * page. Inlining 100 `srcDoc` frames put ~1.7 MB of HTML — over half of it the
 * same ~9.8 KB of injected style and scripts repeated per card — into a single
 * SSR document, entity-escaped inside an attribute, and made
 * `loading="lazy"` useless because the bytes were already in the response.
 *
 * Serving it from a URL instead means the dashboard document carries only short
 * URLs, and the browser fetches just the thumbnails that scroll into view.
 *
 * Security notes:
 *  - Owner-only. Unlike `/raw`, which is public by design because that is how
 *    shared links work, a dashboard thumbnail is only ever shown to its owner,
 *    so this route must not become a second public read surface.
 *  - The response carries `RAW_CSP`, which includes `sandbox allow-scripts`, so
 *    the frame gets an opaque origin with no access to app cookies or storage.
 *    The `srcDoc` version got the same isolation from the `sandbox` attribute on
 *    the iframe; what changes is that the policy is now stated as a real header
 *    instead of being inherited from the app shell.
 *  - `injectPreviewCsp` still adds the meta CSP inside the document, so a
 *    document that is later opened directly still carries its own policy.
 */

/** Bytes of the tab body kept for a thumbnail. Enough to read, not to ship whole. */
const THUMBNAIL_BODY_BYTES = 8000;

export async function loader({ params, request }: Route.LoaderArgs) {
  const { docId, tabSlug } = params;

  const user = await getUser(request);
  if (!user) throw new Response("Unauthorized", { status: 401 });

  const result = await query<{
    html: string;
    content_type: string;
  }>(
    `SELECT LEFT(t.html, POSITION('<body' IN lower(t.html)) + $3) AS html,
            t.content_type
       FROM tabs t
       JOIN docs d ON d.id = t.doc_id
      WHERE t.doc_id = $1
        AND t.slug = $2
        AND d.owner_user_id = $4
        AND d.deleted_at IS NULL`,
    [docId, tabSlug, THUMBNAIL_BODY_BYTES, user.id]
  );

  if (!result.rows.length) throw new Response("Not Found", { status: 404 });

  const { html, content_type } = result.rows[0];
  if (!html) throw new Response("Not Found", { status: 404 });
  // A PDF tab has no HTML to preview; the dashboard renders an icon for those.
  if (content_type === "pdf") throw new Response("Not Found", { status: 404 });

  const document =
    content_type === "markdown" ? markdownToHtml(html)
    : content_type === "doc"    ? docToHtml(html)
    : html;

  // The dashboard knows the resolved theme; the opaque frame cannot read the
  // app's <html class="dark"> from here, so pass it explicitly. When absent the
  // injected script falls back to prefers-color-scheme, as it does for /raw.
  const dark = new URL(request.url).searchParams.get("dark");
  const isDark = dark === null ? undefined : dark === "1";

  const body = injectPreviewCsp(injectDefaultStyles(document, isDark));

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...rawResponseHeaders(),
    },
  });
}
