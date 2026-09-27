import type { Route } from "./+types/thumb.$docId.$tabSlug";
import { query } from "~/lib/db.server";
import { getUser } from "~/lib/auth.server";
import { RAW_CSP } from "~/lib/csp.server";
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
    headers: thumbnailResponseHeaders(),
  });
}

/**
 * Headers for a dashboard thumbnail.
 *
 * These deliberately do NOT reuse rawResponseHeaders(), which carries
 * `Cache-Control: no-store`. That is right for /raw — a shared link must always
 * show the live document — but wrong here, and it made every dashboard visit
 * re-fetch every visible card: `no-store` forbids the *browser's* cache as well
 * as shared caches, so each navigation to /dashboard threw away the thumbnails
 * and paid the query again. With ~12 cards on screen that read as "the images
 * keep loading".
 *
 * What the old header was actually protecting is still protected, by `private`:
 * this is owner-only content reached through an authenticated request, so a
 * shared cache or CDN must never store it. `private` plus a freshness lifetime
 * is the correct way to say that — it keeps the response out of shared caches
 * while letting the one cache that is unambiguously safe, the requesting user's
 * own browser, reuse it.
 *
 * `Vary: Cookie` is load-bearing, not hygiene. The body is decided by an
 * ownership check, so a cached entry must not survive a session change: without
 * it, signing out and into another account on the same browser could let the
 * cache answer a /thumb URL before the loader ever re-checks ownership. Varying
 * on the cookie means a new session never matches the old entry. The cost is
 * only that entries are keyed per session, and a session's cookie is stable, so
 * the hit rate within a login is unaffected.
 *
 * stale-while-revalidate is what makes a return visit feel instant rather than
 * merely cheaper: past max-age the browser paints the cached frame immediately
 * and refetches in the background, instead of showing an empty frame. A preview
 * that can lag a few minutes is a fair trade for not re-querying on every
 * navigation; the card's "Last updated" text still comes from the document row,
 * so it does not lag with it.
 *
 * There is no ETag, so a revalidation is a full body rather than a 304. That is
 * deliberate for now: the ETag would have to be computed from the body, which is
 * only available after the query, and the query is a ~194ms round trip to the
 * hosted database — the body is ~9.8KB by comparison. Avoiding the request
 * entirely via max-age is the win that matters; a 304 would save bytes but not
 * the round trip.
 */
function thumbnailResponseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": RAW_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
    "Vary": "Cookie",
  };
}
