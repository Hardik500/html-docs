/**
 * CSP directive parsing and URL matching for the static analyser.
 *
 * Deliberately free of app imports so it can be exercised directly by
 * Vitest against the real `RAW_CSP`, which is what keeps the analyser from
 * drifting away from the policy the server actually sends.
 */

/** Parses a CSP header string into a map of directive -> source expressions. */
export function parseCsp(csp) {
  const directives = new Map();
  for (const chunk of String(csp).split(";")) {
    const tokens = chunk.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens[0].toLowerCase();
    // Repeated directives are additive in CSP; merge rather than overwrite.
    const existing = directives.get(name) ?? [];
    directives.set(name, [...existing, ...tokens.slice(1)]);
  }
  return directives;
}

const PLACEHOLDER = "https://placeholder.invalid";

function parseUrl(url) {
  try {
    const parsed = new URL(url, PLACEHOLDER);
    return {
      protocol: parsed.protocol.toLowerCase(),
      hostname: parsed.hostname.toLowerCase(),
      port: parsed.port,
      pathname: parsed.pathname,
      origin: parsed.origin.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function schemeOf(url) {
  return parseUrl(url)?.protocol ?? null;
}

function defaultPort(protocol) {
  if (protocol === "https:" || protocol === "wss:") return "443";
  if (protocol === "http:" || protocol === "ws:") return "80";
  return "";
}

/**
 * Matches a CSP host-source (which may carry a path) against a concrete URL.
 *
 * The host must match exactly, or as a subdomain when the source is written
 * with a leading dot. A plain `startsWith` comparison is wrong here: it lets
 * `https://cdn.example.com.evil.test/x.js` satisfy a source of
 * `https://cdn.example.com`, which is an allowlist bypass.
 */
export function hostSourceAllows(source, url) {
  const match = source.match(/^(?:([a-z][a-z0-9+.-]*):)?(\/\/)?([^/]*)(\/.*)?$/i);
  if (!match) return false;
  const [, sourceScheme, , authority, sourcePath = ""] = match;
  if (!authority) return false;

  const target = parseUrl(url);
  if (!target) return false;

  if (sourceScheme) {
    const wanted = `${sourceScheme.toLowerCase()}:`;
    // A scheme source such as "https:" matches only that scheme.
    if (sourceScheme.toLowerCase() !== "*" && target.protocol !== wanted) return false;
  }

  // Split the authority into host and port; an omitted port matches any port.
  const hostMatch = authority.match(/^([^:]*)(?::(\d+|\*))?$/);
  if (!hostMatch) return false;
  const [, sourceHost, sourcePort] = hostMatch;

  const normalizedHost = sourceHost.toLowerCase();
  const isSubdomainSource = normalizedHost.startsWith(".");
  const bareHost = isSubdomainSource ? normalizedHost.slice(1) : normalizedHost;
  if (bareHost === "*") {
    // any host
  } else if (isSubdomainSource) {
    if (target.hostname !== bareHost && !target.hostname.endsWith(`.${bareHost}`)) return false;
  } else if (target.hostname !== bareHost) {
    return false;
  }

  if (sourcePort && sourcePort !== "*") {
    // URL parsing drops the default port, so compare effective ports.
    const targetPort = target.port || defaultPort(target.protocol);
    if (sourcePort !== targetPort) return false;
  }

  // A path in the source must be matched on a segment boundary.
  if (sourcePath && sourcePath !== "/" && !target.pathname.startsWith(sourcePath)) return false;

  return true;
}

/**
 * Decides whether a CSP directive permits a URL.
 * Returns a reason so the analyser can explain itself instead of guessing.
 */
export function directiveAllows(directiveName, sources, url) {
  const list = sources ?? [];
  if (!list.length) return { allowed: true, reason: `${directiveName} is not set` };

  // 'none' only means deny when it is the sole expression in the directive.
  if (list.length === 1 && list[0] === "'none'") {
    return { allowed: false, reason: `${directiveName} 'none'` };
  }
  if (list.includes("'none'")) list = list.filter((s) => s !== "'none'");

  const scheme = schemeOf(url);
  const target = parseUrl(url);
  const origin = target?.origin ?? null;

  for (const source of list) {
    if (source === "*") return { allowed: true, reason: `${directiveName} *` };
    if (source === "'self'") {
      if (origin) return { allowed: true, reason: `${directiveName} 'self'` };
      continue;
    }
    if (source.startsWith("'") && source.endsWith("'")) {
      // 'unsafe-inline' and friends are not URL sources; ignore for URLs.
      continue;
    }
    // Scheme-only sources: "https:", "data:", "blob:", "wss:"
    if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) {
      if (scheme && scheme.toLowerCase() === source.toLowerCase()) {
        return { allowed: true, reason: `${directiveName} ${source}` };
      }
      continue;
    }
    if (hostSourceAllows(source, url)) {
      return { allowed: true, reason: `${directiveName} ${source}` };
    }
  }

  return { allowed: false, reason: `not listed in ${directiveName}` };
}

/** Extracts every URL literal the analyser knows how to reason about. */
export function extractNetworkUrls(html) {
  const found = [];
  const push = (kind, url) => {
    if (typeof url === "string" && /^https?:|^wss?:|^data:/i.test(url)) {
      found.push({ kind, url });
    }
  };
  for (const m of html.matchAll(/\bfetch\s*\(\s*[`'"]([^`'"]+)[`'"]/g)) push("fetch", m[1]);
  for (const m of html.matchAll(/\bnew\s+WebSocket\s*\(\s*[`'"]([^`'"]+)[`'"]/g)) push("websocket", m[1]);
  for (const m of html.matchAll(/\.open\s*\(\s*[`'"][A-Z]+[`'"]\s*,\s*[`'"]([^`'"]+)[`'"]/g)) push("xhr", m[1]);
  for (const m of html.matchAll(/\baxios(?:\.[a-z]+)?\s*\(\s*[`'"]([^`'"]+)[`'"]/g)) push("axios", m[1]);
  return found;
}

/** Extracts src/href values that load a subresource. */
export function extractResourceUrls(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) out.push({ kind: "script-src", url: m[1] });
  for (const m of html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/gi)) {
    out.push({ kind: "style-src", url: m[1] });
  }
  for (const m of html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)) {
    out.push({ kind: "style-src", url: m[1] });
  }
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) out.push({ kind: "img-src", url: m[1] });
  for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) out.push({ kind: "frame-src", url: m[1] });
  for (const m of html.matchAll(/import\s+[^'"]*['"](\bhttps?:\/\/[^'"]+)['"]/g)) {
    out.push({ kind: "script-src", url: m[1] });
  }
  return out.filter((entry) => /^https?:|^data:/i.test(entry.url));
}
