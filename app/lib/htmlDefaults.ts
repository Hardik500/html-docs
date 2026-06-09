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
    --color-background-primary: light-dark(rgba(255, 255, 255, 1), rgba(48, 48, 46, 1));
    --color-background-secondary: light-dark(rgba(245, 244, 237, 1), rgba(38, 38, 36, 1));
    --color-background-tertiary: light-dark(rgba(250, 249, 245, 1), rgba(20, 20, 19, 1));
    --color-background-inverse: light-dark(rgba(20, 20, 19, 1), rgba(250, 249, 245, 1));
    --color-background-ghost: light-dark(rgba(255, 255, 255, 0), rgba(48, 48, 46, 0));
    --color-background-info: light-dark(rgba(214, 228, 246, 1), rgba(37, 62, 95, 1));
    --color-background-danger: light-dark(rgba(247, 236, 236, 1), rgba(96, 42, 40, 1));
    --color-background-success: light-dark(rgba(233, 241, 220, 1), rgba(27, 70, 20, 1));
    --color-background-warning: light-dark(rgba(246, 238, 223, 1), rgba(72, 58, 15, 1));
    --color-background-disabled: light-dark(rgba(255, 255, 255, 0.5), rgba(48, 48, 46, 0.5));
    --color-text-primary: light-dark(rgba(20, 20, 19, 1), rgba(250, 249, 245, 1));
    --color-text-secondary: light-dark(rgba(61, 61, 58, 1), rgba(194, 192, 182, 1));
    --color-text-tertiary: light-dark(rgba(115, 114, 108, 1), rgba(156, 154, 146, 1));
    --color-text-inverse: light-dark(rgba(255, 255, 255, 1), rgba(20, 20, 19, 1));
    --color-text-info: light-dark(rgba(50, 102, 173, 1), rgba(128, 170, 221, 1));
    --color-text-danger: light-dark(rgba(127, 44, 40, 1), rgba(238, 136, 132, 1));
    --color-text-success: light-dark(rgba(38, 91, 25, 1), rgba(122, 185, 72, 1));
    --color-text-warning: light-dark(rgba(90, 72, 21, 1), rgba(209, 160, 65, 1));
    --color-text-disabled: light-dark(rgba(20, 20, 19, 0.5), rgba(250, 249, 245, 0.5));
    --color-text-ghost: light-dark(rgba(115, 114, 108, 0.5), rgba(156, 154, 146, 0.5));
    --color-border-primary: light-dark(rgba(31, 30, 29, 0.4), rgba(222, 220, 209, 0.4));
    --color-border-secondary: light-dark(rgba(31, 30, 29, 0.3), rgba(222, 220, 209, 0.3));
    --color-border-tertiary: light-dark(rgba(31, 30, 29, 0.15), rgba(222, 220, 209, 0.15));
    --color-border-inverse: light-dark(rgba(255, 255, 255, 0.3), rgba(20, 20, 19, 0.15));
    --color-border-ghost: light-dark(rgba(31, 30, 29, 0), rgba(222, 220, 209, 0));
    --color-border-info: light-dark(rgba(70, 130, 213, 1), rgba(70, 130, 213, 1));
    --color-border-danger: light-dark(rgba(167, 61, 57, 1), rgba(205, 92, 88, 1));
    --color-border-success: light-dark(rgba(67, 116, 38, 1), rgba(89, 145, 48, 1));
    --color-border-warning: light-dark(rgba(128, 92, 31, 1), rgba(168, 120, 41, 1));
    --color-border-disabled: light-dark(rgba(31, 30, 29, 0.1), rgba(222, 220, 209, 0.1));
    --color-ring-primary: light-dark(rgba(20, 20, 19, 0.7), rgba(250, 249, 245, 0.7));
    --color-ring-secondary: light-dark(rgba(61, 61, 58, 0.7), rgba(194, 192, 182, 0.7));
    --color-ring-inverse: light-dark(rgba(255, 255, 255, 0.7), rgba(20, 20, 19, 0.7));
    --color-ring-info: light-dark(rgba(50, 102, 173, 0.5), rgba(128, 170, 221, 0.5));
    --color-ring-danger: light-dark(rgba(167, 61, 57, 0.5), rgba(205, 92, 88, 0.5));
    --color-ring-success: light-dark(rgba(67, 116, 38, 0.5), rgba(89, 145, 48, 0.5));
    --color-ring-warning: light-dark(rgba(128, 92, 31, 0.5), rgba(168, 120, 41, 0.5));
    --font-sans: Anthropic Sans, sans-serif;
    --font-mono: ui-monospace, monospace;
    --font-weight-normal: 400;
    --font-weight-medium: 500;
    --font-weight-semibold: 600;
    --font-weight-bold: 700;
    --font-text-xs-size: 12px;
    --font-text-sm-size: 14px;
    --font-text-md-size: 16px;
    --font-text-lg-size: 20px;
    --font-heading-xs-size: 12px;
    --font-heading-sm-size: 14px;
    --font-heading-md-size: 16px;
    --font-heading-lg-size: 20px;
    --font-heading-xl-size: 24px;
    --font-heading-2xl-size: 28px;
    --font-heading-3xl-size: 36px;
    --font-text-xs-line-height: 1.4;
    --font-text-sm-line-height: 1.4;
    --font-text-md-line-height: 1.4;
    --font-text-lg-line-height: 1.25;
    --font-heading-xs-line-height: 1.4;
    --font-heading-sm-line-height: 1.4;
    --font-heading-md-line-height: 1.4;
    --font-heading-lg-line-height: 1.25;
    --font-heading-xl-line-height: 1.25;
    --font-heading-2xl-line-height: 1.1;
    --font-heading-3xl-line-height: 1;
    --border-radius-xs: 4px;
    --border-radius-sm: 6px;
    --border-radius-md: 8px;
    --border-radius-lg: 10px;
    --border-radius-xl: 12px;
    --border-radius-full: 9999px;
    --border-width-regular: 0.5px;
    --shadow-hairline: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    --shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
    --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
    --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
  }
  body { font-family: inherit; background-color: var(--color-background-primary); padding: 8px 16px; }

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

/**
 * Tiny script injected into every iframe document.
 * 1. Immediately sets color-scheme from the system media query so light-dark()
 *    picks the right values before any paint (fallback for direct /raw/ URLs).
 * 2. Listens for { type: 'html-docs-theme', dark: boolean } postMessage from
 *    the parent app so the iframe stays in sync when the user toggles the theme.
 */
// Injected into every iframe document:
// 1. Color-scheme init (light-dark() picks correct values before first paint)
// 2. Listens for theme + scroll-restore postMessages from the parent
// 3. Reports scroll Y to the parent on every scroll so the parent can
//    restore the position when the iframe content is refreshed.
const THEME_SCRIPT = `<script>(function(){var r=document.documentElement;if(!r.style.colorScheme)r.style.colorScheme=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';window.addEventListener('message',function(e){if(!e.data)return;if(e.data.type==='html-docs-theme')r.style.colorScheme=e.data.dark?'dark':'light';if(e.data.type==='html-docs-restore-scroll')window.scrollTo(0,e.data.y||0);});window.addEventListener('scroll',function(){window.parent.postMessage({type:'html-docs-scroll',y:window.scrollY},'*');},{passive:true});})();</script>`;

/**
 * Intercepts all <a> clicks inside the sandboxed iframe.
 * - Pure in-page anchors (#id) → scrollIntoView within the frame.
 * - Everything else → postMessage to parent so it can open the URL in a new
 *   tab. This prevents the sandboxed iframe from navigating (which would
 *   trigger SecurityErrors and 403s on auth-protected pages).
 */
const LINK_SCRIPT = `<script>(function(){document.addEventListener('click',function(e){var a=e.target.closest('a');if(!a)return;var raw=a.getAttribute('href')||'';if(!raw||raw.startsWith('javascript:'))return;e.preventDefault();if(raw.startsWith('#')){var id=raw.slice(1);var t=document.getElementById(id)||document.querySelector('[name="'+id+'"]');if(t)t.scrollIntoView({behavior:'smooth',block:'start'});}else{window.parent.postMessage({type:'html-docs-open-link',url:a.href},'*');}});})();</script>`;

export function injectDefaultStyles(html: string, isDark?: boolean): string {
  const colorSchemeStyle = isDark !== undefined
    ? `<style>:root{color-scheme:${isDark ? "dark" : "light"}}</style>\n  `
    : "";
  const injection = `${INTER_FONTS}\n  ${DEFAULT_STYLE}\n  ${colorSchemeStyle}${THEME_SCRIPT}\n  ${LINK_SCRIPT}`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1\n  ${injection}`);
  }
  return injection + "\n" + html;
}
