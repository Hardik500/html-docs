import {
  data,
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import { appCsp } from "./lib/csp.server";
import { createSupabaseServerClient } from "./lib/supabase.server";
import { isDesktopRuntime } from "./lib/runtime.server";
import "./app.css";

/**
 * Runs for its side effects only: it verifies the Supabase session and, when the
 * access token is missing or near expiry, refreshes it. Refreshed `Set-Cookie`
 * values are collected in the loader's own headers so the `headers` export below
 * can forward them.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const responseHeaders = new Headers();

  // The desktop runtime has no hosted Supabase session. Its local server
  // provides a stable local user through auth.server instead.
  if (!isDesktopRuntime()) {
    // Verify the JWT locally (cached JWKS) and only pay a network round trip to
    // refresh when the access token is missing or near expiry. New tokens are
    // written into responseHeaders via the cookie setAll handler.
    const { supabase } = createSupabaseServerClient(request, responseHeaders);
    const { data: claims, error } = await supabase.auth.getClaims();
    const exp = claims?.claims?.exp;
    const nearExpiry = error != null || typeof exp !== "number" || exp * 1000 - Date.now() < 60_000;
    if (nearExpiry) {
      await supabase.auth.getUser();
    }
  }

  return data(null, { headers: responseHeaders });
}

/**
 * Applies the app-shell security headers to the document response.
 *
 * This must be a `headers` export rather than a `Response` returned from the
 * loader: React Router only honours loader response headers for *resource*
 * routes. A Response returned from a UI loader has its headers discarded
 * silently, so `APP_CSP`, `X-Frame-Options`, HSTS and the session-refresh
 * `Set-Cookie` were never actually sent. Verify with
 * `curl -I <origin>/ | grep -i content-security-policy`.
 *
 * A route's `headers` export is merged with its parents' and takes precedence,
 * so declaring it once on the root covers every document response. No other
 * route exports `headers`, so nothing overrides it — keep it that way.
 */
export const headers: Route.HeadersFunction = ({ loaderHeaders }) => {
  const headers = new Headers(loaderHeaders);

  headers.set("Content-Security-Policy", appCsp());
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // HSTS is meaningless on the plaintext local origins the dev server and the
  // Electron loopback server use, and sending it there can make a browser stop
  // loading http://localhost. Production only.
  if (process.env.NODE_ENV === "production") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return headers;
};


export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Anti-FOUC: set .dark before first paint using stored preference */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('html-docs-theme');if(t==='dark'||(t===null&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();` }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
