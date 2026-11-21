const BLOCKED_SCHEMES = new Set([
  "about",
  "blob",
  "chrome",
  "chrome-extension",
  "data",
  "devtools",
  "edge",
  "file",
  "filesystem",
  "ftp",
  "javascript",
  "mailto",
  "tel",
  "vbscript",
  "view-source",
  "ws",
  "wss",
]);

const LOCAL_HOST =
  /^((?:[a-z0-9-]+\.)*localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i;
const HOST_AND_PORT = /^[^/:?#]+:\d+(?:[/?#]|$)/;

/**
 * Validates user input and reduces it to an http(s) origin.
 *
 * @param {string} rawInput
 * @returns {{ok: true, url: string, origin: string, permissionPattern: string}
 *   | {ok: false, error: string}}
 */
export function normalizeWebUiUrl(rawInput) {
  const input = String(rawInput ?? "").trim();
  if (!input) return { ok: false, error: "Enter your Open WebUI URL." };
  if (/[\s\u0000-\u001f\u007f\\]/.test(input)) {
    return { ok: false, error: "The URL contains invalid characters." };
  }

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(input)?.[1]?.toLowerCase();
  if (scheme && BLOCKED_SCHEMES.has(scheme)) {
    return { ok: false, error: "Only http and https URLs are allowed." };
  }

  let candidate = input;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    if (scheme && !HOST_AND_PORT.test(input)) {
      return { ok: false, error: "Only http and https URLs are allowed." };
    }
    const authority = input.replace(/^\/\//, "");
    candidate = `${LOCAL_HOST.test(authority) ? "http" : "https"}://${authority}`;
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "The URL format is invalid." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http and https URLs are allowed." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "The URL must not include a username or password." };
  }
  if (!parsed.hostname) return { ok: false, error: "The URL is missing a hostname." };
  // "*" is valid in a WHATWG hostname but would widen the Chrome match pattern.
  if (parsed.hostname.includes("*") || parsed.hostname.endsWith(".")) {
    return { ok: false, error: "The URL hostname is invalid. Wildcards are not allowed." };
  }

  return {
    ok: true,
    url: `${parsed.origin}/`,
    origin: parsed.origin,
    permissionPattern: `${parsed.protocol}//${parsed.host}/*`,
  };
}
