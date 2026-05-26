const store = new Map<string, string>();

export function getStoredCookies(hostname: string): string | undefined {
  return store.get(hostname) || store.get(`www.${hostname}`) || undefined;
}

export function setStoredCookies(hostname: string, cookies: string): void {
  store.set(hostname, cookies);
}

export function deleteStoredCookies(hostname: string): void {
  store.delete(hostname);
}

export function getAllStoredCookies(): Record<string, string> {
  return Object.fromEntries(store);
}

function parseCookieString(s: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of s.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) map.set(name, value);
  }
  return map;
}

export function mergeCookies(stored: string | undefined, browser: string | undefined): string | undefined {
  if (!stored && !browser) return undefined;
  if (!stored) return browser;
  if (!browser) return stored;
  const map = parseCookieString(stored);
  for (const [name, value] of parseCookieString(browser)) {
    map.set(name, value);
  }
  return Array.from(map.entries())
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");
}

/**
 * Parse a Set-Cookie header value and return just "name=value" (strips attributes).
 */
function parseSetCookiePair(setCookie: string): { name: string; value: string } | null {
  const firstSemi = setCookie.indexOf(";");
  const pair = firstSemi === -1 ? setCookie : setCookie.slice(0, firstSemi);
  const eq = pair.indexOf("=");
  if (eq === -1) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return null;
  return { name, value };
}

/**
 * Merge cookies from Set-Cookie response headers into the server-side cookie jar
 * for a given hostname. Called automatically by the proxy after each response so
 * that session cookies (e.g. cf_clearance, sessionid) accumulate without the user
 * needing to manually import them.
 */
export function autoMergeCookiesFromSetCookie(hostname: string, setCookieHeaders: string[]): void {
  if (!setCookieHeaders.length) return;
  const existing = parseCookieString(store.get(hostname) || "");
  for (const header of setCookieHeaders) {
    const pair = parseSetCookiePair(header);
    if (pair) existing.set(pair.name, pair.value);
  }
  if (existing.size > 0) {
    store.set(hostname, Array.from(existing.entries()).map(([n, v]) => `${n}=${v}`).join("; "));
  }
}
