import { Router } from "express";
import { parse as parseHTML } from "node-html-parser";

const router = Router();

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-CH-UA": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

function rewriteUrl(url: string, proxyBase: string): string {
  if (!url || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("javascript:") || url.startsWith("#")) {
    return url;
  }
  return `${proxyBase}?url=${encodeURIComponent(url)}`;
}

function rewriteHtml(html: string, pageUrl: string, proxyBase: string): string {
  const root = parseHTML(html, { lowerCaseTagName: false, comment: true });

  // Rewrite href attributes on <a>, <link>
  for (const el of root.querySelectorAll("a[href], area[href]")) {
    const href = el.getAttribute("href");
    if (href) {
      const abs = resolveUrl(pageUrl, href);
      el.setAttribute("href", rewriteUrl(abs, proxyBase));
    }
  }

  for (const el of root.querySelectorAll("link[href]")) {
    const href = el.getAttribute("href");
    if (href) {
      const abs = resolveUrl(pageUrl, href);
      el.setAttribute("href", rewriteUrl(abs, proxyBase));
    }
  }

  // Rewrite src on img, script, iframe, video, audio, source
  for (const el of root.querySelectorAll("[src]")) {
    const src = el.getAttribute("src");
    if (src) {
      const abs = resolveUrl(pageUrl, src);
      el.setAttribute("src", rewriteUrl(abs, proxyBase));
    }
  }

  // Rewrite srcset
  for (const el of root.querySelectorAll("[srcset]")) {
    const srcset = el.getAttribute("srcset");
    if (srcset) {
      const rewritten = srcset.replace(/([^\s,]+)(\s*(?:\d+[wx])?)/g, (match, url, descriptor) => {
        if (!url.startsWith("data:")) {
          const abs = resolveUrl(pageUrl, url);
          return rewriteUrl(abs, proxyBase) + descriptor;
        }
        return match;
      });
      el.setAttribute("srcset", rewritten);
    }
  }

  // Rewrite action on forms
  for (const el of root.querySelectorAll("form[action]")) {
    const action = el.getAttribute("action");
    if (action) {
      const abs = resolveUrl(pageUrl, action);
      el.setAttribute("action", rewriteUrl(abs, proxyBase));
    }
  }

  // Inject base target to open links in same iframe
  const head = root.querySelector("head");
  if (head) {
    // Remove existing base tags
    for (const base of root.querySelectorAll("base")) {
      base.remove();
    }
  }

  // Inject script to notify parent of URL changes and intercept fetch
  const script = `
<script>
(function() {
  function notifyParent(url, title) {
    try {
      window.parent.postMessage({ type: 'proxy-navigate', url: url, title: title || document.title }, '*');
    } catch(e) {}
  }
  
  // Notify on load
  window.addEventListener('load', function() {
    notifyParent(window.location.href, document.title);
  });

  // Intercept pushState/replaceState
  var origPush = history.pushState.bind(history);
  var origReplace = history.replaceState.bind(history);
  history.pushState = function() {
    origPush.apply(history, arguments);
    notifyParent(window.location.href, document.title);
  };
  history.replaceState = function() {
    origReplace.apply(history, arguments);
    notifyParent(window.location.href, document.title);
  };
  window.addEventListener('popstate', function() {
    notifyParent(window.location.href, document.title);
  });
})();
</script>`;

  if (head) {
    head.insertAdjacentHTML("afterbegin", script);
  } else {
    const body = root.querySelector("body");
    if (body) body.insertAdjacentHTML("afterbegin", script);
  }

  return root.toString();
}

function rewriteCss(css: string, pageUrl: string, proxyBase: string): string {
  // Rewrite url(...) in CSS
  return css.replace(/url\((['"]?)([^)'"]+)\1\)/gi, (match, quote, url) => {
    if (url.startsWith("data:") || url.startsWith("blob:")) return match;
    const abs = resolveUrl(pageUrl, url);
    return `url(${quote}${rewriteUrl(abs, proxyBase)}${quote})`;
  });
}

router.get("/proxy", async (req, res) => {
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

  const proxyBase = `${req.protocol}://${req.get("host")}/api/proxy`;

  const forwardHeaders: Record<string, string> = { ...BROWSER_HEADERS };
  forwardHeaders["Host"] = parsedUrl.hostname;
  forwardHeaders["Origin"] = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
  forwardHeaders["Referer"] = `${parsedUrl.protocol}//${parsedUrl.hostname}/`;

  // Forward cookies if any
  const cookieHeader = req.headers["x-proxy-cookie"] as string;
  if (cookieHeader) {
    forwardHeaders["Cookie"] = cookieHeader;
  }

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: forwardHeaders,
      redirect: "follow",
    });

    const contentType = response.headers.get("content-type") || "";

    // Forward Set-Cookie as custom header (browsers can't set cross-origin cookies)
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      res.setHeader("X-Proxy-Set-Cookie", setCookie);
    }

    // Set CORS headers so iframe can load this
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Content-Security-Policy", "");

    if (contentType.includes("text/html")) {
      const html = await response.text();
      const rewritten = rewriteHtml(html, response.url || targetUrl, proxyBase);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(rewritten);
    } else if (contentType.includes("text/css")) {
      const css = await response.text();
      const rewritten = rewriteCss(css, response.url || targetUrl, proxyBase);
      res.setHeader("Content-Type", contentType);
      res.send(rewritten);
    } else {
      // For binary/other content, stream it through
      res.setHeader("Content-Type", contentType);
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    }
  } catch (err) {
    req.log.error({ err, url: targetUrl }, "Proxy fetch failed");
    res.status(502).json({ error: "Failed to fetch the requested URL", details: String(err) });
  }
});

export default router;
