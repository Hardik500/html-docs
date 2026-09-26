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

// ─── Fixture expectations ─────────────────────────────────────────────────────
//
// The analyser reports which subresources the policy blocks. That is a *report*,
// not a verdict: much of the fixture set exists precisely to assert that the
// policy blocks something. Treating every blocked finding as a failure made the
// gate permanently red, which is the same as having no gate at all.
//
// So each fixture declares what it expects and the gate checks that expectation
// in both directions: a positive fixture must have nothing blocked, and a
// negative fixture must have everything it reaches for blocked. The second half
// is what makes the lookalike-host fixture a real regression guard — if host
// matching ever regressed to a prefix comparison those URLs would become allowed
// and the gate would fail.

export const EXPECT_ALLOWED = "allowed";
export const EXPECT_BLOCKED = "blocked";

// The marker keyword and its value are matched separately. Matching them in one
// pattern makes an unrecognised value ("blockedish") fail to match at all, which
// silently downgrades the fixture to the default expectation instead of
// reporting the typo.
const MARKER_PRESENT = /<!--\s*csp-expect\s*:/i;
// Tolerates a trailing explanation inside the comment, e.g.
// <!-- csp-expect: blocked — lookalike hosts must not resolve -->.
const EXPECTATION_MARKER = /<!--\s*csp-expect\s*:\s*([a-z]+)\b[^>]*-->/i;

/**
 * Reads a fixture's declared expectation. Defaults to `allowed`, so a new fixture
 * is treated as a positive case. Throws when a marker is present but its value is
 * unrecognised, so a typo cannot quietly disable a check.
 */
export function readFixtureExpectation(html) {
  if (!MARKER_PRESENT.test(html)) return EXPECT_ALLOWED;
  const found = EXPECTATION_MARKER.exec(html)?.[1]?.toLowerCase();
  if (found !== EXPECT_ALLOWED && found !== EXPECT_BLOCKED) {
    throw new Error(
      `Unrecognised csp-expect value ${found ? `"${found}"` : "(missing)"} — ` +
        `expected "${EXPECT_ALLOWED}" or "${EXPECT_BLOCKED}"`,
    );
  }
  return found;
}

/** Collapses duplicate findings so one URL is not reported several times. */
export function dedupeFindings(findings) {
  const seen = new Set();
  const out = [];
  for (const finding of findings) {
    const key = `${finding.directive}|${finding.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

/**
 * Judges one fixture against its declared expectation.
 *
 * Returns `status` of "pass" | "warn" | "fail" plus human-readable `problems`,
 * so the caller can print a reason instead of only a colour.
 */
export function classifyFixture(expectation, analysis) {
  const blocked = dedupeFindings(analysis.blocked ?? []);
  const allowed = dedupeFindings(analysis.allowed ?? []);
  const sandboxed = analysis.sandboxed ?? [];
  const problems = [];

  if (expectation === EXPECT_BLOCKED) {
    if (allowed.length) {
      problems.push(
        `${allowed.length} reference(s) must be blocked but the policy allows them: ` +
          allowed.map((a) => `[${a.directive}] ${a.url}`).join(", "),
      );
    }
    if (!blocked.length) {
      problems.push(
        "fixture declares csp-expect: blocked but nothing it references is blocked, " +
          "so it no longer exercises the policy",
      );
    }
  } else if (blocked.length) {
    problems.push(
      `${blocked.length} reference(s) the fixture expects to work are blocked: ` +
        blocked.map((b) => `[${b.directive}] ${b.url} (${b.reason})`).join(", "),
    );
  }

  if (problems.length) return { status: "fail", problems, blocked, allowed, sandboxed };
  if (sandboxed.length) return { status: "warn", problems, blocked, allowed, sandboxed };
  return { status: "pass", problems, blocked, allowed, sandboxed };
}
