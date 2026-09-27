export const PREVIEW_CSP = [
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
].join("; ");

/**
 * Injects the policy as an in-document meta.
 *
 * `policy` defaults to PREVIEW_CSP, which is what /raw and the editor preview
 * use. A dashboard thumbnail passes THUMB_CSP instead, so the meta it carries
 * does not re-permit the third-party origins its response header forbids — a
 * document opened directly later still gets the real PREVIEW_CSP, but the
 * thumbnail on the dashboard is not allowed to phone out to a CDN at all.
 */
export function injectPreviewCsp(html: string, { policy = PREVIEW_CSP }: { policy?: string } = {}): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1\n  ${meta}`);
  }
  return meta + "\n" + html;
}
