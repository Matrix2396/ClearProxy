import { Router } from "express";
import { parse as parseHTML } from "node-html-parser";
import { getStoredCookies, mergeCookies, autoMergeCookiesFromSetCookie } from "../lib/cookie-store";
import { getSelectedUaPreset } from "../lib/ua-store";

const router = Router();

function getBrowserHeadersBase(): Record<string, string> {
  const preset = getSelectedUaPreset();
  const headers: Record<string, string> = {
    "User-Agent": preset.ua,
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
  if (preset.secChUa) headers["Sec-CH-UA"] = preset.secChUa;
  if (preset.secChUaMobile) headers["Sec-CH-UA-Mobile"] = preset.secChUaMobile;
  if (preset.secChUaPlatform) headers["Sec-CH-UA-Platform"] = preset.secChUaPlatform;
  return headers;
}

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

  // Grab the real Location.prototype href descriptor so we can read/write the
  // actual browser URL after we override location.href below.
  var _realHrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href')
                   || Object.getOwnPropertyDescriptor(location, 'href');
  function _realHref() {
    try { return _realHrefDesc.get.call(location); } catch(e) { return ''; }
  }
  function _realSetHref(url) {
    try { _realHrefDesc.set.call(location, url); } catch(e) {}
  }

  // ── Iframe detection bypass ──────────────────────────────────────────
  try { Object.defineProperty(window, 'self',        { get: function() { return window; }, configurable: true }); } catch(e) {}
  try { Object.defineProperty(window, 'top',         { get: function() { return window; }, configurable: true }); } catch(e) {}
  try { Object.defineProperty(window, 'frameElement',{ get: function() { return null;   }, configurable: true }); } catch(e) {}
  try { Object.defineProperty(window, 'parent',      { get: function() { return window; }, configurable: true }); } catch(e) {}

  // ── Track the real (un-proxied) URL ──────────────────────────────────
  // SPA routers read location.pathname / location.href after pushState to
  // decide which component to render. Without this they see '/api/proxy'
  // instead of e.g. '/play/online' and render a 404 page.
  var _pxCurrentUrl = __PX_URL__;
  function _pxParsed() { try { return new URL(_pxCurrentUrl); } catch(e) { return new URL(__PX_URL__); } }

  // Store the proxied origin in sessionStorage so that if the iframe ever
  // lands on a page on our own domain (e.g. /play/online after a pushState),
  // the NotFound recovery component can redirect back through the proxy.
  try { sessionStorage.setItem('__px_origin__', new URL(__PX_URL__).origin); } catch(e) {}
  try { sessionStorage.setItem('__px_current__', __PX_URL__); } catch(e) {}

  // ── Location spoofing ────────────────────────────────────────────────
  // Full spoof: hostname, host, origin, protocol, pathname, search, hash,
  // href (getter + setter), location.assign, location.replace.
  try {
    try { Object.defineProperty(location, 'hostname', { get: function() { return _pxParsed().hostname; }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(location, 'host',     { get: function() { var u=_pxParsed(); return u.port ? u.hostname+':'+u.port : u.hostname; }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(location, 'origin',   { get: function() { var u=_pxParsed(); return u.protocol+'//'+u.hostname+(u.port?':'+u.port:''); }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(location, 'protocol', { get: function() { return _pxParsed().protocol; }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(location, 'pathname', { get: function() { return _pxParsed().pathname; }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(location, 'search',   { get: function() { return _pxParsed().search;   }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(location, 'hash',     { get: function() { return _pxParsed().hash;     }, configurable: true }); } catch(e) {}
    try {
      Object.defineProperty(location, 'href', {
        get: function() { return _pxCurrentUrl; },
        set: function(url) {
          try {
            var abs = new URL(String(url), _pxCurrentUrl).href;
            _pxCurrentUrl = abs;
            _realSetHref(toProxyUrl(abs));
          } catch(e) { _realSetHref(url); }
        },
        configurable: true
      });
    } catch(e) {}
  } catch(e) {}

  // ── URL helpers ──────────────────────────────────────────────────────
  function toProxyUrl(url) {
    if (!url || typeof url !== 'string') return url;
    try {
      if (url.indexOf(__PX_BASE__ + '?url=') !== -1) return url;
      if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:') || url.startsWith('#')) return url;
      var abs = new URL(url, _pxCurrentUrl).href;
      return __PX_BASE__ + '?url=' + encodeURIComponent(abs);
    } catch(e) { return url; }
  }

  function toWsProxyUrl(url) {
    try {
      var abs = new URL(url, _pxCurrentUrl).href;
      // Use _realOrigin (captured before override) so the WS proxy URL points to OUR server
      var wsBase = _realOrigin.replace(/^http/, 'ws') + '/api/ws-proxy';
      return wsBase + '?url=' + encodeURIComponent(abs);
    } catch(e) { return url; }
  }

  // Extract original URL from a proxy URL (?url= param)
  function extractOriginalUrl(href) {
    try {
      var u = new URL(href);
      var param = u.searchParams.get('url');
      return param || href;
    } catch(e) { return href; }
  }

  // ── location.assign / location.replace / location.reload ─────────────
  // These cause full navigations — rewrite the target URL through the proxy.
  try {
    location.assign = function(url) {
      try {
        var abs = new URL(String(url), _pxCurrentUrl).href;
        _pxCurrentUrl = abs;
        _realSetHref(toProxyUrl(abs));
      } catch(e) {}
    };
  } catch(e) {}
  try {
    location.replace = function(url) {
      try {
        var abs = new URL(String(url), _pxCurrentUrl).href;
        _pxCurrentUrl = abs;
        _realSetHref(toProxyUrl(abs));
      } catch(e) {}
    };
  } catch(e) {}
  // Override reload() so that reloading a SPA-pushed path (e.g. /play/online)
  // navigates back through the proxy rather than reloading our React shell.
  try {
    location.reload = function() {
      _realSetHref(toProxyUrl(_pxCurrentUrl));
    };
  } catch(e) {}

  // ── Parent notifications (debounced, deduplicated) ───────────────────
  var _lastNotifyUrl = '';
  var _notifyTimer = 0;
  function notify(url, title) {
    if (!url || url === _lastNotifyUrl) return;
    _lastNotifyUrl = url;
    // Keep sessionStorage current so NotFound recovery can reconstruct the URL
    try { sessionStorage.setItem('__px_current__', url); } catch(e) {}
    clearTimeout(_notifyTimer);
    _notifyTimer = setTimeout(function() {
      try { _realParent.postMessage({ type: 'proxy-navigate', url: url, title: title || document.title }, '*'); } catch(e) {}
    }, 150);
  }

  window.addEventListener('load', function() { notify(_pxCurrentUrl, document.title); });

  var _push = history.pushState.bind(history);
  var _replace = history.replaceState.bind(history);

  // Helper: resolve url against current real URL, update tracking, return
  // the URL that should be passed to the native pushState/replaceState.
  // KEY INSIGHT: for relative/path-only URLs we pass them through UNCHANGED
  // so the SPA router sees the correct location.pathname (e.g. '/play/online').
  // Only full absolute URLs need rewriting to a relative path so the browser
  // doesn't throw a cross-origin SecurityError.
  function _pxRewritePushUrl(url) {
    var origUrl = new URL(String(url), _pxCurrentUrl).href;
    _pxCurrentUrl = origUrl;
    // If url was already relative (no scheme), leave it alone so the browser
    // gives the SPA router the correct pathname naturally.
    if (!/^https?:/i.test(String(url))) return url;
    // Absolute URL → strip to path+search+hash to keep it same-origin
    var parsed = new URL(origUrl);
    return parsed.pathname + parsed.search + parsed.hash;
  }

  history.pushState = function(s, t, url) {
    if (url) { try { url = _pxRewritePushUrl(String(url)); } catch(e) {} }
    _push.call(history, s, t, url);
    notify(_pxCurrentUrl, document.title);
  };
  history.replaceState = function(s, t, url) {
    if (url) { try { url = _pxRewritePushUrl(String(url)); } catch(e) {} }
    _replace.call(history, s, t, url);
    notify(_pxCurrentUrl, document.title);
  };
  window.addEventListener('popstate', function() {
    // After back/forward: browser URL is the path chess.com pushed (/play/online)
    // Reconstruct the full real URL using the chess.com origin
    try {
      var realHref = _realHref();
      // If it looks like a proxy URL (?url= param), extract from it
      var u = new URL(realHref);
      var param = u.searchParams.get('url');
      if (param) {
        _pxCurrentUrl = param;
      } else {
        // It's a plain path the SPA pushed — combine with the chess.com origin
        var chessOrigin = new URL(__PX_URL__).origin;
        _pxCurrentUrl = chessOrigin + u.pathname + u.search + u.hash;
      }
    } catch(e) {}
    notify(_pxCurrentUrl, document.title);
  });

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

  // ── Fix document.currentScript.src for bundler publicPath computation ──
  // Webpack/Vite often compute their public path by reading
  // document.currentScript.src at module init time. Since we serve scripts
  // through /api/proxy?url=…, currentScript.src is our proxy URL rather
  // than the real chess.com URL, so the publicPath ends up as "/api/" and
  // all chunk requests land on /api/<chunk>.js (which we 404).
  // We intercept the getter and unwrap the ?url= param so bundlers see the
  // real origin URL and compute the correct publicPath.
  (function() {
    var _csDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'currentScript');
    if (!_csDesc) return;
    Object.defineProperty(Document.prototype, 'currentScript', {
      get: function() {
        var cs = _csDesc.get.call(this);
        if (!cs) return cs;
        try {
          return new Proxy(cs, {
            get: function(target, prop) {
              if (prop === 'src' || prop === 'baseURI') {
                try {
                  var raw = _csDesc.get.call(document)? target[prop] : target[prop];
                  var u = new URL(String(raw));
                  var real = u.searchParams.get('url');
                  if (real) return real;
                } catch(e) {}
              }
              var v = target[prop];
              return typeof v === 'function' ? v.bind(target) : v;
            }
          });
        } catch(e) { return cs; }
      },
      configurable: true
    });
  })();

  // ── Intercept DOM src/href property assignments ───────────────────────
  // Lazy-loaded images (and scripts/iframes) set src via JS property
  // assignment, which bypasses fetch/XHR interceptors. Override the
  // prototype setters so every assignment goes through the proxy.
  (function() {
    function proxySrcSetter(proto, prop) {
      var desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc || !desc.set) return;
      var _orig = desc.set;
      Object.defineProperty(proto, prop, {
        get: desc.get,
        set: function(val) {
          try { val = toProxyUrl(String(val)); } catch(e) {}
          _orig.call(this, val);
        },
        configurable: true,
        enumerable: desc.enumerable
      });
    }
    try { proxySrcSetter(HTMLImageElement.prototype,  'src');      } catch(e) {}
    try { proxySrcSetter(HTMLScriptElement.prototype, 'src');      } catch(e) {}
    try { proxySrcSetter(HTMLIFrameElement.prototype, 'src');      } catch(e) {}
    try { proxySrcSetter(HTMLSourceElement.prototype, 'src');      } catch(e) {}
    try { proxySrcSetter(HTMLSourceElement.prototype, 'srcset');   } catch(e) {}
    try { proxySrcSetter(HTMLLinkElement.prototype,   'href');     } catch(e) {}
    try { proxySrcSetter(HTMLMediaElement.prototype,  'src');      } catch(e) {}
  })();

  // Also intercept setAttribute so data-src / data-original style lazy
  // loaders that later do img.src = img.dataset.src get proxied values.
  (function() {
    var _origSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
      var lname = name.toLowerCase();
      if (lname === 'src' || lname === 'href' || lname === 'action' ||
          lname === 'data-src' || lname === 'data-lazy-src' || lname === 'data-original') {
        try { value = toProxyUrl(String(value)); } catch(e) {}
      }
      return _origSetAttr.call(this, name, value);
    };
  })();

  // ── Intercept new Worker(url) ─────────────────────────────────────────
  // Routes dedicated workers and module workers through the proxy so that
  // WASM workers, chess engine workers, etc. load correctly.
  var _OrigWorker = window.Worker;
  if (_OrigWorker) {
    function ProxiedWorker(url, opts) {
      try { if (url && typeof url === 'string') url = toProxyUrl(url); } catch(e) {}
      return opts !== undefined ? new _OrigWorker(url, opts) : new _OrigWorker(url);
    }
    ProxiedWorker.prototype = _OrigWorker.prototype;
    ProxiedWorker.CONNECTING = _OrigWorker.CONNECTING;
    try { window.Worker = ProxiedWorker; } catch(e) {}
  }

  // ── Suppress / stub Service Worker registration ───────────────────────
  // Service Workers register at origin scope and intercept fetch on their
  // own origin. Under a proxy they'd register against our proxy domain,
  // intercept proxy requests, and break navigation. Stub the API so the
  // page doesn't error but also doesn't install a broken SW.
  try {
    if (navigator.serviceWorker) {
      var _swReg = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = function(scriptURL, options) {
        // Attempt to register through proxy so chess.com's SW actually runs;
        // fall back to a resolved no-op if that fails.
        try {
          var proxied = toProxyUrl(new URL(String(scriptURL), __PX_URL__).href);
          return _swReg(proxied, options).catch(function() {
            return Promise.resolve({ scope: '/', active: null, installing: null, waiting: null,
              addEventListener: function(){}, removeEventListener: function(){} });
          });
        } catch(e2) {
          return Promise.resolve({ scope: '/', active: null, installing: null, waiting: null,
            addEventListener: function(){}, removeEventListener: function(){} });
        }
      };
    }
  } catch(e) {}

  // ── Spoof navigator properties chess.com inspects ────────────────────
  try { Object.defineProperty(navigator, 'webdriver', { get: function(){ return false; }, configurable: true }); } catch(e) {}
  try { Object.defineProperty(navigator, 'plugins',   { get: function(){ return [1,2,3,4,5]; }, configurable: true }); } catch(e) {}
  try { Object.defineProperty(navigator, 'languages', { get: function(){ return ['en-US','en']; }, configurable: true }); } catch(e) {}
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

  // Rewrite data-src / data-lazy-src / data-original on any element.
  // Many sites (chess.com included) lazy-load images by setting
  // img.src = img.dataset.src in JS — we pre-rewrite the data attribute so
  // when JS reads it and assigns to .src, it gets the proxy URL.
  for (const attr of ["data-src", "data-lazy-src", "data-original", "data-url"]) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const val = el.getAttribute(attr);
      if (val) {
        const abs = resolveUrl(pageUrl, val);
        el.setAttribute(attr, rewriteUrl(abs));
      }
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

  // ── import.meta.url patching ──────────────────────────────────────────
  // Must run BEFORE global import.meta.url replacement so we can produce
  // the correct proxy URL for static string literals.
  // Pattern: new URL('./asset.wasm', import.meta.url)
  //       or new URL('/abs/path', import.meta.url)
  //       or new URL('https://…', import.meta.url)
  js = js.replace(
    /\bnew URL\(\s*(["'`])((?:https?:\/\/|\/|\.\.?\/)[^"'`\\]*)\1\s*,\s*import\.meta\.url\s*\)/g,
    (_, _q, relUrl) => {
      const proxied = proxyifyImport(resolveUrl(pageUrl, relUrl));
      return `new URL(${JSON.stringify(proxied)}, location.origin)`;
    }
  );

  // Replace all remaining import.meta.url references with the actual file URL
  // so that new URL(dynamicExpr, import.meta.url) resolves to the correct origin
  // and so that code inspecting import.meta.url for the script's own path works.
  js = js.replace(/\bimport\.meta\.url\b/g, JSON.stringify(pageUrl));

  // ── ES module import path rewriting ──────────────────────────────────
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

function computeSecFetchSite(targetUrl: URL, refererUrl: URL | null): string {
  if (!refererUrl) return "none";
  if (refererUrl.hostname === targetUrl.hostname) return "same-origin";
  const refParts = refererUrl.hostname.split(".").slice(-2).join(".");
  const tgtParts = targetUrl.hostname.split(".").slice(-2).join(".");
  if (refParts === tgtParts) return "same-site";
  return "cross-site";
}

function buildFetchHeaders(
  targetUrl: URL,
  isDocument: boolean,
  proxyCookie?: string,
  proxyReferer?: string,
): Record<string, string> {
  // Parse the real referer URL (the proxied page the user came from)
  let refererUrl: URL | null = null;
  if (proxyReferer) {
    try { refererUrl = new URL(proxyReferer); } catch {}
  }

  const secFetchSite = computeSecFetchSite(targetUrl, refererUrl);

  const headers: Record<string, string> = {
    ...getBrowserHeadersBase(),
    Host: targetUrl.hostname,
    Origin: `${targetUrl.protocol}//${targetUrl.hostname}`,
  };

  if (isDocument) {
    headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";
    headers["Sec-Fetch-Dest"] = "document";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-Site"] = secFetchSite;
    headers["Sec-Fetch-User"] = "?1";
    headers["Upgrade-Insecure-Requests"] = "1";
    // Use the real referer when navigating within a site
    headers["Referer"] = refererUrl
      ? `${refererUrl.protocol}//${refererUrl.hostname}${refererUrl.pathname}${refererUrl.search}`
      : `${targetUrl.protocol}//${targetUrl.hostname}/`;
  } else {
    headers["Accept"] = "*/*";
    headers["Sec-Fetch-Dest"] = "empty";
    headers["Sec-Fetch-Mode"] = "cors";
    headers["Sec-Fetch-Site"] = secFetchSite === "none" ? "same-origin" : secFetchSite;
    headers["Referer"] = refererUrl
      ? `${refererUrl.protocol}//${refererUrl.hostname}${refererUrl.pathname}${refererUrl.search}`
      : `${targetUrl.protocol}//${targetUrl.hostname}/`;
  }

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

  // Merge stored session cookies (imported by user) with browser-forwarded cookies.
  // Browser-forwarded cookies take precedence (they carry live Set-Cookie responses).
  const storedCookie = getStoredCookies(parsedUrl.hostname);
  const browserCookie = (req.headers["x-proxy-cookie"] || req.headers["cookie"]) as string | undefined;
  const proxyCookie = mergeCookies(storedCookie, browserCookie);
  const isDocument = !req.headers["x-requested-with"];

  // Extract the real proxied URL from the browser's Referer header.
  // The browser sends Referer as our proxy URL (/api/proxy?url=https://...) —
  // we unwrap the ?url= param to get the real origin URL so Sec-Fetch-Site
  // and Referer forwarded to the target are accurate.
  let proxyReferer: string | undefined;
  const rawReferer = req.headers["referer"] as string | undefined;
  if (rawReferer) {
    try {
      const refUrl = new URL(rawReferer, "http://localhost");
      const unwrapped = refUrl.searchParams.get("url");
      proxyReferer = unwrapped || rawReferer;
    } catch {}
  }

  const fetchHeaders = buildFetchHeaders(parsedUrl, isDocument, proxyCookie, proxyReferer);

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
      // Auto-store cookies from this response into the server-side jar so future
      // requests to this host automatically include them (e.g. login sessions, cf_clearance).
      autoMergeCookiesFromSetCookie(parsedUrl.hostname, allSetCookies);
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

// ── Smart fallback: re-proxy chunk/asset requests that bypassed URL rewriting ──
// When a proxied JS module does a DYNAMIC import('./chunk.js') that our static
// regex couldn't rewrite, the browser resolves the relative path against the
// module's URL (e.g. /api/proxy?url=…/play.js → /api/chunk.js).
// We catch those here and use the Referer header to reconstruct the real
// chess.com URL, then forward to the proxy handler.
router.get(/.*/, async (req, res) => {
  const referer = (req.headers["referer"] || req.headers["referrer"] || "") as string;

  // Try to find a proxied-URL base from the Referer
  let chessUrl = "";
  try {
    const refUrl = new URL(referer, "http://localhost");
    const proxiedBase = refUrl.searchParams.get("url");
    if (proxiedBase) {
      // req.path is e.g. "/init.Bggg6JTtWg.chunk.js" (router strips /api prefix)
      // Resolve relative to the proxied resource's directory
      chessUrl = new URL(req.path.replace(/^\//, "./"), proxiedBase).href;
    }
  } catch {
    /* ignore */
  }

  if (!chessUrl) {
    res.status(404).send("Not found");
    return;
  }

  // Re-use our proxy handler by rewriting the query param
  req.query.url = chessUrl;
  // Forward internally to the proxy route by just running its logic
  // (simplest: redirect to the proxy endpoint on our own server)
  res.redirect(302, `/api/proxy?url=${encodeURIComponent(chessUrl)}`);
});

export default router;
