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
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

/**
 * Extra security headers applied to /raw responses.
 */
export function rawResponseHeaders(): HeadersInit {
  return {
    "Content-Security-Policy": RAW_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "public, max-age=60",
  };
}
