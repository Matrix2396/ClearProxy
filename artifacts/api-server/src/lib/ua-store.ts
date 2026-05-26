export interface UaPreset {
  label: string;
  ua: string;
  secChUa?: string;
  secChUaMobile?: string;
  secChUaPlatform?: string;
}

export const UA_PRESETS: Record<string, UaPreset> = {
  "chrome-win": {
    label: "Chrome (Windows)",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="136", "Google Chrome";v="136", "Not-A.Brand";v="99"',
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
  },
  "chrome-mac": {
    label: "Chrome (Mac)",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="136", "Google Chrome";v="136", "Not-A.Brand";v="99"',
    secChUaMobile: "?0",
    secChUaPlatform: '"macOS"',
  },
  "firefox-win": {
    label: "Firefox (Windows)",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0",
  },
  "safari-mac": {
    label: "Safari (Mac)",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
  },
  "mobile-chrome": {
    label: "Mobile Chrome (Android)",
    ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.6478.122 Mobile Safari/537.36",
    secChUa: '"Chromium";v="136", "Google Chrome";v="136", "Not-A.Brand";v="99"',
    secChUaMobile: "?1",
    secChUaPlatform: '"Android"',
  },
  "mobile-safari": {
    label: "Mobile Safari (iPhone)",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
  },
};

let currentUaKey = "chrome-win";

export function getSelectedUaKey(): string {
  return currentUaKey;
}

export function setSelectedUaKey(key: string): boolean {
  if (!UA_PRESETS[key]) return false;
  currentUaKey = key;
  return true;
}

export function getSelectedUaPreset(): UaPreset {
  return UA_PRESETS[currentUaKey];
}
