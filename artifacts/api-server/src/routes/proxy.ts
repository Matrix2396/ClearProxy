import { Router } from "express";
import { parse as parseHTML } from "node-html-parser";

const router = Router();

const BROWSER_HEADERS_BASE: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-CH-UA": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Platform": '"Windows"',
};

const BROWSER_HEADERS_DOCUMENT: Record<string, string> = {
  ...BROWSER_HEADERS_BASE,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const BROWSER_HEADERS_RESOURCE: Record<string, string> = {
  ...BROWSER_HEADERS_BASE,
  Accept: "*/*",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

// Headers we must never forward to the browser (they'd cause double-decompression or other issues)
const STRIP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "transfer-encoding",
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
]);

const PROXY_PATH = "/api/proxy";

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

function rewriteUrl(url: string): string {
  if (
    !url ||
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("javascript:") ||
    url.startsWith("#") ||
    url.startsWith(PROXY_PATH)
  ) {
    return url;
  }
  return `${PROXY_PATH}?url=${encodeURIComponent(url)}`;
}

function buildInjectedScript(pageUrl: string): string {
  return `<script>
(function() {
  var __PX_URL__ = ${JSON.stringify(pageUrl)};
  var __PX_BASE__ = ${JSON.stringify(PROXY_PATH)};

  // ── Capture real refs BEFORE any overrides ──────────────────────────
  var _realParent = window.parent;
  var _realOrigin = location.origin;   // needed for WS proxy URL after location override

  // ── Iframe detection bypass ──────────────────────────────────────────
  try { Object.defineProperty(window, 'self',        { get: function() { return window; }, configurable: true }); } catch(e) {}
  try { Object.defineProperty(window, 'top',         { get: function() { return window; }, configurable: true }); } catch(e) {}
  try { Object.defineProperty(window, 'frameElement',{ get: function() { return null;   }, configurable: true }); } catch(e) {}
  try { Object.defineProperty(window, 'parent',      { get: function() { return window; }, configurable: true }); } catch(e) {}

  // ── Location spoofing ────────────────────────────────────────────────
  // Many sites (chess.com, etc.) check location.hostname to decide whether
  // to render. Override so the page sees its own domain, not our proxy.
  try {
    var _pxU = new URL(__PX_URL__);
    var _pxProto    = _pxU.protocol;
    var _pxHostname = _pxU.hostname;
    var _pxHost     = _pxU.port ? _pxU.hostname + ':' + _pxU.port : _pxU.hostname;
    var _pxOriginFake = _pxProto + '//' + _pxHost;
    try { Object.defineProperty(location, 'hostname', { get: function() { return _pxHostname; }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(location, 'host',     { get: function() { return _pxHost;     }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(location, 'origin',   { get: function() { return _pxOriginFake; }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(location, 'protocol', { get: function() { return _pxProto;    }, configurable: true }); } catch(e) {}
  } catch(e) {}

  // ── URL helpers ──────────────────────────────────────────────────────
  function toProxyUrl(url) {
    if (!url || typeof url !== 'string') return url;
    try {
      if (url.indexOf(__PX_BASE__ + '?url=') !== -1) return url;
      if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:') || url.startsWith('#')) return url;
      var abs = new URL(url, __PX_URL__).href;
      return __PX_BASE__ + '?url=' + encodeURIComponent(abs);
    } catch(e) { return url; }
  }

  function toWsProxyUrl(url) {
    try {
      var abs = new URL(url, __PX_URL__).href;
      // Use _realOrigin (captured before override) so the WS proxy URL points to OUR server
      var wsBase = _realOrigin.replace(/^http/, 'ws') + '/api/ws-proxy';
      return wsBase + '?url=' + encodeURIComponent(abs);
    } catch(e) { return url; }
  }

  function extractOriginalUrl(href) {
    try {
      var u = new URL(href, location.href);
      var param = u.searchParams.get('url');
      return param || href;
    } catch(e) { return href; }
  }

  // ── Parent notifications (debounced, deduplicated) ───────────────────
  var _lastNotifyUrl = '';
  var _notifyTimer = 0;
  function notify(url, title) {
    if (!url || url === _lastNotifyUrl) return;
    _lastNotifyUrl = url;
    clearTimeout(_notifyTimer);
    _notifyTimer = setTimeout(function() {
      try { _realParent.postMessage({ type: 'proxy-navigate', url: url, title: title || document.title }, '*'); } catch(e) {}
    }, 150);
  }

  window.addEventListener('load', function() { notify(__PX_URL__, document.title); });

  var _push = history.pushState.bind(history);
  var _replace = history.replaceState.bind(history);
  history.pushState = function(s, t, url) {
    if (url) { try { url = toProxyUrl(String(url)); } catch(e){} }
    _push.call(history, s, t, url);
    notify(extractOriginalUrl(location.href), document.title);
  };
  history.replaceState = function(s, t, url) {
    if (url) { try { url = toProxyUrl(String(url)); } catch(e){} }
    _replace.call(history, s, t, url);
    notify(extractOriginalUrl(location.href), document.title);
  };
  window.addEventListener('popstate', function() { notify(extractOriginalUrl(location.href), document.title); });

  // ── Intercept fetch ──────────────────────────────────────────────────
  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      if (typeof input === 'string') { input = toProxyUrl(input); }
      else if (input instanceof Request) { input = new Request(toProxyUrl(input.url), {method:input.method,headers:input.headers,body:input.body,mode:'cors',credentials:input.credentials,cache:input.cache,redirect:input.redirect,referrer:input.referrer,integrity:input.integrity}); }
    } catch(e) {}
    return _fetch.apply(window, [input, init]);
  };

  // ── Intercept XMLHttpRequest ─────────────────────────────────────────
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
    try { url = toProxyUrl(String(url)); } catch(e) {}
    return _open.call(this, method, url, async !== false, user, pass);
  };

  // ── Intercept WebSocket ──────────────────────────────────────────────
  // Routes WebSocket connections through our server-side WS proxy so
  // real-time apps (chess.com game board, etc.) work correctly.
  var _OrigWS = window.WebSocket;
  function ProxiedWebSocket(url, protocols) {
    var proxyUrl;
    try { proxyUrl = toWsProxyUrl(String(url)); } catch(e) { proxyUrl = url; }
    return protocols !== undefined ? new _OrigWS(proxyUrl, protocols) : new _OrigWS(proxyUrl);
  }
  ProxiedWebSocket.prototype = _OrigWS.prototype;
  ProxiedWebSocket.CONNECTING = _OrigWS.CONNECTING;
  ProxiedWebSocket.OPEN       = _OrigWS.OPEN;
  ProxiedWebSocket.CLOSING    = _OrigWS.CLOSING;
  ProxiedWebSocket.CLOSED     = _OrigWS.CLOSED;
  try { window.WebSocket = ProxiedWebSocket; } catch(e) {}

  // ── Intercept window.open ────────────────────────────────────────────
  var _winOpen = window.open;
  window.open = function(url, target, features) {
    try { if (url) url = toProxyUrl(String(url)); } catch(e) {}
    return _winOpen.call(window, url, target, features);
  };
})();
</script>`;
}

function rewriteHtml(html: string, pageUrl: string): string {
  const root = parseHTML(html, { lowerCaseTagName: false, comment: true });

  // Remove existing base tags
  for (const base of root.querySelectorAll("base")) {
    base.remove();
  }

  // Remove SRI integrity + crossorigin attrs — content is rewritten so hashes won't match
  for (const el of root.querySelectorAll("script[integrity], link[integrity]")) {
    el.removeAttribute("integrity");
    el.removeAttribute("crossorigin");
  }

  // Rewrite <meta http-equiv="refresh" content="0; url=...">
  for (const el of root.querySelectorAll('meta[http-equiv="refresh"], meta[http-equiv="Refresh"]')) {
    const content = el.getAttribute("content") || "";
    const rewritten = content.replace(/url=(['"]?)([^'";\s]+)\1/i, (_m, q, u) => {
      const abs = resolveUrl(pageUrl, u);
      return `url=${q}${rewriteUrl(abs)}${q}`;
    });
    if (rewritten !== content) el.setAttribute("content", rewritten);
  }

  // Rewrite CSS url() inside inline <style> blocks
  for (const el of root.querySelectorAll("style")) {
    const text = el.text;
    if (text) el.set_content(rewriteCss(text, pageUrl));
  }

  // Rewrite url() in inline style attributes
  for (const el of root.querySelectorAll("[style]")) {
    const style = el.getAttribute("style") || "";
    if (style.includes("url(")) {
      el.setAttribute("style", rewriteCss(style, pageUrl));
    }
  }

  // Rewrite href on <a>, <area>, <link>
  for (const el of root.querySelectorAll("a[href], area[href], link[href]")) {
    const href = el.getAttribute("href");
    if (href) {
      const abs = resolveUrl(pageUrl, href);
      el.setAttribute("href", rewriteUrl(abs));
    }
  }

  // Rewrite src on all elements
  for (const el of root.querySelectorAll("[src]")) {
    const src = el.getAttribute("src");
    if (src) {
      const abs = resolveUrl(pageUrl, src);
      el.setAttribute("src", rewriteUrl(abs));
    }
  }

  // Rewrite srcset
  for (const el of root.querySelectorAll("[srcset]")) {
    const srcset = el.getAttribute("srcset");
    if (srcset) {
      const rewritten = srcset.replace(/([^\s,]+)(\s+(?:\d+(?:\.\d+)?[wx])?)?(,|\s*$)/g, (match, url, descriptor, sep) => {
        if (!url || url.startsWith("data:")) return match;
        const abs = resolveUrl(pageUrl, url);
        return rewriteUrl(abs) + (descriptor || "") + (sep || "");
      });
      el.setAttribute("srcset", rewritten);
    }
  }

  // Rewrite data-src on <script> tags — chess.com/Vite lazy-load scripts via
  // data-src and then do `script.src = script.dataset.src` in JS. The browser's
  // native src assignment bypasses our fetch override, so we must pre-rewrite
  // the data-src value here so the JS ends up assigning a proxy URL.
  for (const el of root.querySelectorAll("script[data-src]")) {
    const dataSrc = el.getAttribute("data-src");
    if (dataSrc) {
      const abs = resolveUrl(pageUrl, dataSrc);
      el.setAttribute("data-src", rewriteUrl(abs));
    }
  }

  // Rewrite action on forms
  for (const el of root.querySelectorAll("form[action]")) {
    const action = el.getAttribute("action");
    if (action) {
      const abs = resolveUrl(pageUrl, action);
      el.setAttribute("action", rewriteUrl(abs));
    }
  }

  // Inject interception script before anything else in <head>
  const injected = buildInjectedScript(pageUrl);
  const head = root.querySelector("head");
  if (head) {
    head.insertAdjacentHTML("afterbegin", injected);
  } else {
    const body = root.querySelector("body");
    if (body) {
      body.insertAdjacentHTML("afterbegin", injected);
    } else {
      root.insertAdjacentHTML("afterbegin", injected);
    }
  }

  return root.toString();
}

function rewriteJsImports(js: string, pageUrl: string): string {
  let origin: string;
  try { origin = new URL(pageUrl).origin; } catch { return js; }

  function proxyifyImport(url: string): string {
    if (!url || url.startsWith(PROXY_PATH)) return url;
    if (url.startsWith("data:") || url.startsWith("blob:")) return url;
    let abs: string;
    if (/^https?:\/\//i.test(url)) {
      abs = url;
    } else if (url.startsWith("/")) {
      abs = origin + url;
    } else {
      try { abs = new URL(url, pageUrl).href; } catch { return url; }
    }
    return `${PROXY_PATH}?url=${encodeURIComponent(abs)}`;
  }

  // from "url" / from 'url'  (covers import … from and export … from)
  js = js.replace(/\bfrom\s*(["'])((?:\/|\.\.?\/|https?:\/\/)[^"'\\]+)\1/g,
    (_, q, url) => `from ${q}${proxyifyImport(url)}${q}`);

  // import "url" / import 'url'  (side-effect imports)
  js = js.replace(/\bimport\s*(["'])((?:\/|\.\.?\/|https?:\/\/)[^"'\\]+)\1/g,
    (_, q, url) => `import ${q}${proxyifyImport(url)}${q}`);

  // dynamic import("url") / import('url')
  js = js.replace(/\bimport\s*\(\s*(["'])((?:\/|\.\.?\/|https?:\/\/)[^"'\\]+)\1\s*\)/g,
    (_, q, url) => `import(${q}${proxyifyImport(url)}${q})`);

  return js;
}

function rewriteCss(css: string, pageUrl: string): string {
  return css.replace(/url\((['"]?)([^)'"]+)\1\)/gi, (match, quote, url) => {
    if (url.startsWith("data:") || url.startsWith("blob:")) return match;
    const abs = resolveUrl(pageUrl, url);
    return `url(${quote}${rewriteUrl(abs)}${quote})`;
  });
}

function buildFetchHeaders(targetUrl: URL, isDocument: boolean, proxyCookie?: string): Record<string, string> {
  const base = isDocument ? BROWSER_HEADERS_DOCUMENT : BROWSER_HEADERS_RESOURCE;
  const headers: Record<string, string> = {
    ...base,
    Host: targetUrl.hostname,
    Origin: `${targetUrl.protocol}//${targetUrl.hostname}`,
    Referer: `${targetUrl.protocol}//${targetUrl.hostname}/`,
  };
  if (proxyCookie) headers["Cookie"] = proxyCookie;
  return headers;
}

router.all("/proxy", async (req, res) => {
  const targetUrl = req.query.url as string;

  if (!targetUrl) {
    res.status(400).json({ error: "Missing url parameter" });
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  // Use explicit proxy cookie header first; fall back to the browser's own Cookie
  // header (which accumulates Set-Cookie values our proxy previously forwarded,
  // including Cloudflare cf_clearance and site session tokens).
  const proxyCookie = (req.headers["x-proxy-cookie"] || req.headers["cookie"]) as string | undefined;
  const isDocument = !req.headers["x-requested-with"];
  const fetchHeaders = buildFetchHeaders(parsedUrl, isDocument, proxyCookie);

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  let bodyInit: BodyInit | undefined;
  if (hasBody) {
    const ct = req.headers["content-type"] || "";
    // express.json() / express.urlencoded() may have already consumed the stream.
    // If so, req.body is populated — reconstruct the raw body from it.
    if (req.body !== undefined && req.body !== null && !(req.body instanceof Buffer)) {
      if (ct.includes("application/json")) {
        bodyInit = JSON.stringify(req.body);
        fetchHeaders["Content-Type"] = ct;
      } else if (ct.includes("application/x-www-form-urlencoded")) {
        bodyInit = new URLSearchParams(req.body as Record<string, string>).toString();
        fetchHeaders["Content-Type"] = ct;
      }
    } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      // express.raw() middleware already gave us a Buffer
      bodyInit = req.body;
      if (ct) fetchHeaders["Content-Type"] = ct;
    } else {
      // Stream not yet consumed — read it directly (e.g. multipart, binary, etc.)
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve) => {
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", resolve);
      });
      const raw = Buffer.concat(chunks);
      if (raw.length > 0) {
        bodyInit = raw;
        if (ct) fetchHeaders["Content-Type"] = ct;
      }
    }
  }

  try {
    const response = await fetch(targetUrl, {
      method,
      headers: fetchHeaders,
      body: bodyInit,
      redirect: "follow",
    });

    const finalUrl = response.url || targetUrl;
    const contentType = response.headers.get("content-type") || "application/octet-stream";

    // Forward safe response headers, strip dangerous ones
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (!STRIP_RESPONSE_HEADERS.has(lower)) {
        try { res.setHeader(key, value); } catch {}
      }
    });

    // Override/add required headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");

    // Forward ALL Set-Cookie headers from the target as real Set-Cookie on our domain.
    // Stripping Domain forces the browser to store them under our domain, so they
    // are automatically sent back as the Cookie header on every subsequent proxied
    // request — this is how Cloudflare cf_clearance and site session tokens propagate.
    const allSetCookies: string[] =
      typeof (response.headers as any).getSetCookie === "function"
        ? (response.headers as any).getSetCookie()
        : [response.headers.get("set-cookie")].filter(Boolean);
    if (allSetCookies.length > 0) {
      const sanitized = allSetCookies.map((c) =>
        // Strip Domain so the cookie belongs to our proxy domain, not the target's domain.
        c.replace(/;\s*domain=[^;]*/gi, "")
      );
      res.setHeader("Set-Cookie", sanitized);
    }

    if (contentType.includes("text/html")) {
      const html = await response.text();
      const rewritten = rewriteHtml(html, finalUrl);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(rewritten);
    } else if (contentType.includes("text/css")) {
      const css = await response.text();
      const rewritten = rewriteCss(css, finalUrl);
      res.setHeader("Content-Type", contentType.includes("charset") ? contentType : `${contentType}; charset=utf-8`);
      res.send(rewritten);
    } else if (contentType.includes("application/javascript") || contentType.includes("text/javascript")) {
      // Rewrite ES module import paths so the browser fetches chunks through our proxy
      // instead of hitting the origin domain directly (which breaks for absolute-path imports)
      const js = await response.text();
      const rewrittenJs = rewriteJsImports(js, finalUrl);
      res.setHeader("Content-Type", contentType);
      res.send(rewrittenJs);
    } else {
      const buffer = await response.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      res.send(Buffer.from(buffer));
    }
  } catch (err) {
    req.log.error({ err, url: targetUrl }, "Proxy fetch failed");
    res.status(502).send(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>Proxy Error</title>
      <style>body{font-family:monospace;background:#0a0a0f;color:#e0e0e0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px}h2{color:#00ffff;margin:0}p{color:#888;font-size:13px;margin:0;max-width:400px;text-align:center}</style>
      </head>
      <body>
        <h2>Unable to load page</h2>
        <p>${String(err).replace(/</g, "&lt;")}</p>
        <p style="font-size:11px;color:#555">This site may block proxy access or require a direct connection.</p>
      </body>
      </html>
    `);
  }
});

export default router;
