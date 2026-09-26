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
