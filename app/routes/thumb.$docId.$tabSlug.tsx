import type { Route } from "./+types/thumb.$docId.$tabSlug";
import { query } from "~/lib/db.server";
import { getUser } from "~/lib/auth.server";
import { THUMB_CSP } from "~/lib/csp.server";
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
 *  - The response carries `THUMB_CSP`, which includes `sandbox allow-scripts`, so
 *    the frame gets an opaque origin with no access to app cookies or storage.
 *    The `srcDoc` version got the same isolation from the `sandbox` attribute on
 *    the iframe; what changes is that the policy is now stated as a real header
 *    instead of being inherited from the app shell.
 *  - `injectPreviewCsp` still adds the meta CSP inside the document, so a
 *    document that is later opened directly still carries its own policy.
 */

/**
 * Bytes of the tab *body* kept for a thumbnail. Enough to read, not to ship
 * whole.
 */
const THUMBNAIL_BODY_BYTES = 8000;

export async function loader({ params, request }: Route.LoaderArgs) {
  const { docId, tabSlug } = params;

  const user = await getUser(request);
  if (!user) throw new Response("Unauthorized", { status: 401 });

  // Slice from the start of <body>, not from the start of the document.
  //
  // This used to be LEFT(t.html, POSITION('<body' ...) + $3), which returns the
  // whole document up to $3 bytes past <body> — so the $3 budget applied to the
  // body but the *entire head* was shipped on top of it. A document with a large
  // inline <style> or a block of inline scripts in its head therefore produced a
  // "thumbnail" far larger than the document it was previewing. Measured on
  // seeded documents:
  //
  //   head of 8 KB of inline CSS   -> 271,333 bytes served
  //   head of 8 KB of inline <script> -> 257,931 bytes served
  //   ordinary document            ->   9,848 bytes served
  //
  // That is a per-card payload the moment anything real is stored — a Google
  // Docs export arrives carrying exactly that kind of head — so a dozen cards
  // pulled megabytes on every dashboard visit, in every browser. It is what made
  // the previews "keep loading", and it evicts the HTTP cache, which is why
  // making them cacheable did not visibly help.
  //
  // GREATEST(..., 1) because SUBSTRING's FROM must be >= 1, and a `doc` or
  // `markdown` tab stores a fragment with no <body> at all, where POSITION
  // returns 0. Those keep their previous behaviour: the first $3 bytes of the
  // stored text, which is what the converters want.
  const result = await query<{
    html: string;
    content_type: string;
  }>(
    `SELECT SUBSTRING(t.html FROM GREATEST(POSITION('<body' IN lower(t.html)), 1) FOR $3) AS html,
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

  const body = injectPreviewCsp(
    injectDefaultStyles(document, isDark, { fonts: false }),
    { policy: THUMB_CSP },
  );

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
 * stale-while-revalidate lets a returning browser paint the cached frame and
 * refresh it behind the scenes once the entry is well past its lifetime.
 *
 * The lifetime is 1 hour, and that number is measured rather than guessed. With
 * max-age=60 the return visit was a cache hit only when it happened within the
 * first minute; at 75s the response was re-fetched from the network
 * (Network.responseReceived reported fromDiskCache=false), which is precisely
 * the "images keep loading" report. Opening a document and coming back takes
 * longer than a minute, so a minute-long freshness window bought almost nothing.
 * An hour makes the return visit reliably a hit. stale-while-revalidate is kept
 * for the case where a card is genuinely older than that, but it is not what
 * makes the common case fast, and it is not claimed to be: the same measurement
 * showed it does not produce an instant-from-cache iframe paint on its own.
 *
 * The trade is a preview that can be up to an hour behind the document. That is
 * acceptable here because the preview is decorative — the card's title, tab
 * count and "Last updated" all come from the document row in the dashboard's own
 * query, so nothing on the card is stale, only the picture of it. Shortening the
 * lifetime is a one-line change here if that balance is ever wrong.
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
    "Content-Security-Policy": THUMB_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
    "Vary": "Cookie",
  };
}
