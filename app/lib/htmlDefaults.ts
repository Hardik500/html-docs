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
  /* html-docs defaults — every rule here is overridden by any later author rule */

  /* Design tokens */
  :root {
    font-family: 'Inter', ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --color-background-primary:   #F9F9F7;
    --color-background-secondary: #EEEDE8;
    --color-text-primary:         #1A1A18;
    --color-text-secondary:       #6B6B6B;
    --color-border-tertiary:      #E2E2DC;
    --border-radius-sm:           4px;
    --border-radius-md:           8px;
    --border-radius-lg:           12px;
  }
  body { font-family: inherit; background-color: #F9F9F7; }

  /* Layout helpers */
  .g2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 1.25rem; }
  .g3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin-bottom: 1.25rem; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

  /* Metric card */
  .mc { background: var(--color-background-secondary); border-radius: var(--border-radius-md); padding: 0.8rem 1rem; }
  .mc .l { font-size: 12px; color: var(--color-text-secondary); margin: 0 0 3px; }
  .mc .v { font-size: 20px; font-weight: 500; margin: 0; color: var(--color-text-primary); }
  .mc .s { font-size: 11px; color: var(--color-text-secondary); margin: 2px 0 0; }

  /* Card & divider */
  .card { background: var(--color-background-primary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-lg); padding: 1rem 1.25rem; margin-bottom: 10px; }
  .divider { border: none; border-top: 0.5px solid var(--color-border-tertiary); margin: 1.25rem 0; }
  h3s { display: block; font-size: 15px; font-weight: 500; color: var(--color-text-primary); margin: 1.25rem 0 0.75rem 0; }

  /* Tags */
  .tag { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: var(--border-radius-md); font-weight: 500; }
  .tg { background: #EAF3DE; color: #27500A; }
  .ta { background: #FAEEDA; color: #633806; }
  .tr { background: #FCEBEB; color: #791F1F; }
  .tb { background: #E6F1FB; color: #0C447C; }
  .tp { background: #EEEDFE; color: #3C3489; }

  /* Progress bar */
  .pbar-w { height: 5px; background: var(--color-background-secondary); border-radius: 3px; overflow: hidden; margin-top: 5px; }
  .pbar   { height: 100%; border-radius: 3px; }

  /* Bullet list */
  .bullet { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 8px; font-size: 13px; color: var(--color-text-secondary); line-height: 1.5; }
  .bico   { flex-shrink: 0; font-size: 15px; margin-top: 1px; }

  /* Legend */
  .leg { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; font-size: 12px; color: var(--color-text-secondary); }
  .ld  { width: 10px; height: 10px; border-radius: 2px; display: inline-block; margin-right: 3px; }

  /* Tax box */
  .tax-box { background: var(--color-background-secondary); border-radius: var(--border-radius-md); padding: 0.9rem 1rem; margin-bottom: 10px; }
  .tax-row { display: flex; justify-content: space-between; font-size: 13px; padding: 5px 0; border-bottom: 0.5px solid var(--color-border-tertiary); color: var(--color-text-secondary); }
  .tax-row:last-child { border-bottom: none; }
  .tax-row span:last-child { font-weight: 500; color: var(--color-text-primary); }
</style>`;

const INJECTION = `${INTER_FONTS}\n  ${DEFAULT_STYLE}`;

export function injectDefaultStyles(html: string): string {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1\n  ${INJECTION}`);
  }
  return INJECTION + "\n" + html;
}
