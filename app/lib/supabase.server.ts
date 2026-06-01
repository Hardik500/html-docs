import { createServerClient, type CookieOptions } from "@supabase/ssr";

export function createSupabaseServerClient(
  request: Request,
  responseHeaders: Headers = new Headers()
) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieMap = parseCookies(cookieHeader);

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return Object.entries(cookieMap).map(([name, value]) => ({
            name,
            value,
          }));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            // Force HttpOnly — Supabase SSR defaults to httpOnly: false, which
            // would leave session tokens readable by JS (exploitable via XSS in
            // the editor shell where unsafe-inline/unsafe-eval are required by Monaco).
            responseHeaders.append(
              "Set-Cookie",
              serializeCookie(name, value, { ...options, httpOnly: true })
            );
          });
        },
      },
    }
  );

  return { supabase, responseHeaders };
}

function parseCookies(header: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key) map[key] = decodeURIComponent(val);
  }
  return map;
}

function serializeCookie(
  name: string,
  value: string,
  opts: CookieOptions = {}
): string {
  let str = `${name}=${encodeURIComponent(value)}`;
  if (opts.maxAge != null) str += `; Max-Age=${opts.maxAge}`;
  if (opts.path) str += `; Path=${opts.path}`;
  if (opts.expires) str += `; Expires=${opts.expires.toUTCString()}`;
  if (opts.httpOnly) str += `; HttpOnly`;
  if (opts.secure) str += `; Secure`;
  if (opts.sameSite) {
    const ss =
      typeof opts.sameSite === "boolean"
        ? opts.sameSite
          ? "Strict"
          : ""
        : opts.sameSite.charAt(0).toUpperCase() + opts.sameSite.slice(1);
    if (ss) str += `; SameSite=${ss}`;
  }
  if (opts.domain) str += `; Domain=${opts.domain}`;
  return str;
}
