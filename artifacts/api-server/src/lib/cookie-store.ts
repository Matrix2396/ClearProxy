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
