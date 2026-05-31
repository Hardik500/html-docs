/**
 * Injects a default font style (Inter, matching the app UI) into HTML documents
 * that haven't specified their own font. Injected before any user content so
 * user-defined styles always win via the normal CSS cascade.
 */

const INTER_FONTS = [
  `<link rel="preconnect" href="https://fonts.googleapis.com">`,
  `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
  `<link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap" rel="stylesheet">`,
].join("\n  ");

const DEFAULT_STYLE = `<style>
  /* html-docs default typography — overridden by any author font-family rule */
  :root { font-family: 'Inter', ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  body  { font-family: inherit; }
</style>`;

const INJECTION = `${INTER_FONTS}\n  ${DEFAULT_STYLE}`;

export function injectDefaultStyles(html: string): string {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1\n  ${INJECTION}`);
  }
  return INJECTION + "\n" + html;
}
