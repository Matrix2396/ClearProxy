import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

httpServer.on("upgrade", (request, socket, head) => {
  const reqUrl = request.url ?? "";

  if (!reqUrl.startsWith("/api/ws-proxy")) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (clientWs) => {
    let targetUrl: string;
    try {
      const parsed = new URL(reqUrl, `http://${request.headers.host}`);
      targetUrl = parsed.searchParams.get("url") ?? "";
      if (!targetUrl) throw new Error("missing url param");
      new URL(targetUrl); // validate
    } catch {
      clientWs.close(1008, "Invalid or missing url parameter");
      return;
    }

    let origin: string;
    try {
      const u = new URL(targetUrl);
      origin = `${u.protocol === "wss:" ? "https" : "http"}://${u.hostname}`;
    } catch {
      origin = "https://chess.com";
    }

    // Forward subprotocols the client requested (e.g. chess.com sends specific protocol ids)
    const protocolHeader = request.headers["sec-websocket-protocol"];
    const subprotocols = protocolHeader
      ? protocolHeader.split(",").map((p) => p.trim())
      : undefined;

    const targetWs = new WebSocket(targetUrl, subprotocols, {
      headers: {
        "User-Agent": BROWSER_UA,
        Origin: origin,
        "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits",
      },
      rejectUnauthorized: false,
    });

    targetWs.on("open", () => {
      logger.info({ targetUrl }, "WS proxy connected");
    });

    targetWs.on("message", (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: isBinary });
      }
    });

    clientWs.on("message", (data, isBinary) => {
      if (targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(data, { binary: isBinary });
      }
    });

    targetWs.on("close", (code, reason) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(code, reason);
      }
    });

    clientWs.on("close", () => {
      if (targetWs.readyState !== WebSocket.CLOSED) {
        targetWs.close();
      }
    });

    targetWs.on("error", (err) => {
      logger.warn({ err, targetUrl }, "WS proxy target error");
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1011, "Target error");
      }
    });

    clientWs.on("error", (err) => {
      logger.warn({ err }, "WS proxy client error");
      if (targetWs.readyState !== WebSocket.CLOSED) {
        targetWs.close();
      }
    });
  });
});

httpServer.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});
