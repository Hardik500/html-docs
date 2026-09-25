const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Validate and normalize the hosted origin used by the desktop client.
 * Packaged builds must use HTTPS; HTTP is reserved for local development.
 */
function normalizeRemoteUrl(value, { allowHttpLoopback = false } = {}) {
  if (typeof value !== "string") return "";

  const trimmed = value.trim();
  if (!trimmed) return "";

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Desktop remote URL must be a valid absolute URL");
  }

  if (url.username || url.password) {
    throw new Error("Desktop remote URL must not contain credentials");
  }

  const isHttps = url.protocol === "https:";
  const isLoopbackHttp =
    allowHttpLoopback &&
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname.toLowerCase());

  if (!isHttps && !isLoopbackHttp) {
    throw new Error("Desktop remote URL must use HTTPS");
  }

  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Desktop remote URL must contain only an origin");
  }

  return url.origin;
}

module.exports = { normalizeRemoteUrl };
