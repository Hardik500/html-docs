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

export function injectPreviewCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1\n  ${meta}`);
  }
  return meta + "\n" + html;
}
