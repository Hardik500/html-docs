/**
 * CSP for the app shell (editor, viewer, dashboard).
 * Permissive on scripts/styles to accommodate Monaco editor (blob: workers,
 * unsafe-inline), but locks down fonts, frames, objects, and base-uri.
 *
 * This is the production policy, and `app/root.tsx` sends it on every document
 * response. Keep the two in step when editing it here.
 */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https:",
  "worker-src blob:",
  "frame-src blob: 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * The policy for the current runtime.
 *
 * The dev server needs no relaxation: Vite's HMR socket is same-origin (CSP3
 * `'self'` covers the `ws:` scheme on the same host and port) and the preamble
 * it injects is covered by the existing `'unsafe-inline'` / `'unsafe-eval'`.
 * Keep it that way — do not widen the production policy for a dev-only need. If
 * dev does break, confirm it in a real browser first and add the narrowest
 * directive that fixes it.
 */
export function appCsp(): string {
  return APP_CSP;
}

/**
 * CSP for raw HTML iframe content — allows inline scripts/styles and
 * common CDNs but blocks same-origin access and parent navigation.
 */
export const RAW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://cdn.skypack.dev",
  "style-src 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src https: data:",
  "connect-src https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://cdn.skypack.dev",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  // Prevent direct /raw navigation from becoming a same-origin application document.
  "sandbox allow-scripts",
].join("; ");

/**
 * Policy for dashboard thumbnails.
 *
 * A thumbnail is a static preview shown only to its owner, and it must not
 * contact any third party. RAW_CSP is right for /raw — a shared link is a real
 * document, so its Tailwind Play CDN script, webfonts and images all have to
 * work — but applying it to a grid of a dozen thumbnails means a dozen
 * documents each opening connections to Google Fonts and cdn.tailwindcss.com at
 * once. Measured on the dashboard: the thumbnail requests themselves completed
 * in tens of milliseconds, but the grid took ~3.5s to settle because every
 * frame was waiting on third-party CSS, webfonts and scripts, and the frames
 * stay blank until those arrive.
 *
 * cdn.tailwindcss.com is the worst of them: it is a runtime CSS compiler, so a
 * document using it cannot paint until the script has downloaded and run.
 *
 * So the preview gets system fonts, inline styles and local images only. This is
 * also the safer default: a dashboard full of documents should not be leaking a
 * request per card to third-party CDNs on the owner's behalf.
 */
export const THUMB_CSP = [
  "default-src 'none'",
  // Inline styles and the injected theme/anchor scripts still run, but nothing
  // is fetched from a third-party origin.
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "img-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  // The dashboard frame is a sandboxed opaque origin, as it was with RAW_CSP.
  "sandbox allow-scripts",
].join("; ");

/**
 * Extra security headers applied to /raw responses.
 */
export function rawBinaryResponseHeaders(): HeadersInit {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Content-Disposition": "inline",
  };
}

export function rawResponseHeaders(): HeadersInit {
  return {
    "Content-Security-Policy": RAW_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
  };
}
