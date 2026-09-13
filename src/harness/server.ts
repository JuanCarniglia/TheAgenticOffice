import "dotenv/config";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage } from "../shared/types.js";
import { lockedOfficeOptionsFromEnv } from "../shared/types.js";
import { OfficeSession } from "./session.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const DIST = resolve(process.cwd(), "dist");
const SERVE_GAME = existsSync(join(DIST, "index.html"));

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isApiPath(pathname: string): boolean {
  return pathname === "/health" || pathname === "/config" || pathname === "/ws" || pathname.startsWith("/session");
}

function envLocks() {
  return lockedOfficeOptionsFromEnv(process.env);
}

function withOfficeLocks(html: string): string {
  const tag = `<script>window.__OFFICE_LOCKS__=${JSON.stringify(envLocks())};</script>`;
  if (html.includes("__OFFICE_LOCKS__")) return html;
  if (html.includes("</head>")) return html.replace("</head>", `${tag}</head>`);
  return `${tag}${html}`;
}

function serveGame(req: IncomingMessage, res: ServerResponse): boolean {
  if (!SERVE_GAME) return false;
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  if (isApiPath(url.pathname)) return false;

  const rel = decodeURIComponent(url.pathname) === "/"
    ? "index.html"
    : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  let file = normalize(join(DIST, rel));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return true;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (extname(rel)) {
      res.writeHead(404).end("Not found");
      return true;
    }
    file = join(DIST, "index.html");
  }
  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  const isHtml = extname(file).toLowerCase() === ".html";
  if (isHtml) {
    const body = withOfficeLocks(readFileSync(file, "utf8"));
    const buf = Buffer.from(body);
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": buf.length,
      "Cache-Control": "no-cache",
    });
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    res.end(buf);
    return true;
  }
  const st = statSync(file);
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": st.size,
    "Cache-Control": "public, max-age=86400",
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}

const app = new Hono();
const session = new OfficeSession();

app.use("/*", cors());

function noStoreJson(c: { header: (k: string, v: string) => void }) {
  c.header("Cache-Control", "no-store");
}

app.get("/health", (c) => {
  noStoreJson(c);
  return c.json({ ok: true, service: "agentic-office-harness", game: SERVE_GAME, locks: envLocks() });
});

app.get("/config", (c) => {
  noStoreJson(c);
  return c.json({ locks: envLocks() });
});

app.get("/session", (c) => c.json(session.snapshot()));

app.post("/session/start", async (c) => {
  const body = (await c.req.json()) as ClientMessage;
  if (body.type !== "start") return c.json({ ok: false, error: "expected start payload" }, 400);
  await session.handle(body);
  return c.json({ ok: true, state: session.snapshot() });
});

const hono = getRequestListener(app.fetch);
const server = createServer((req, res) => {
  if (serveGame(req, res)) return;
  void hono(req, res);
});
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: WebSocket) => {
  session.attach(ws);
  ws.on("message", (raw) => {
    try {
      const message = JSON.parse(String(raw)) as ClientMessage;
      void session.handle(message);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Bad client message" }));
    }
  });
});

server.listen(PORT, HOST, () => {
  const game = SERVE_GAME ? " + game" : "";
  console.log(`Harness listening on http://${HOST}:${PORT}${game}`);
  const locks = envLocks();
  if (locks.provider || locks.model || locks.floor) {
    console.log("Office settings locked from .env", locks);
  }
});
