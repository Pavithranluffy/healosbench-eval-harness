import { auth } from "@test-evals/auth";
import { env } from "@test-evals/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createRunsRouter } from "./routes/runs";
import { compareRouter } from "./routes/compare";
import { transcriptsRouter } from "./routes/transcripts";

const app = new Hono();

app.use(async (c, next) => {
  console.log(`[DEBUG] Incoming Request: ${c.req.method} ${c.req.url}`);
  console.log(`[DEBUG] Origin Header: ${c.req.header("origin")}`);
  await next();
});

// 1. GLOBAL CORS - Must be first
app.use(
  "*",
  cors({
    origin: (origin) => {
      console.log(`[DEBUG] CORS Check for Origin: ${origin}`);
      if (!origin) return env.CORS_ORIGIN;
      // Allow any Vercel subdomain or localhost
      if (origin.endsWith(".vercel.app") || origin.includes("localhost")) {
        return origin;
      }
      return env.CORS_ORIGIN;
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-better-auth-api-key", "better-auth-agent"],
    credentials: true,
    exposeHeaders: ["Set-Cookie"],
  }),
);

app.use(logger());

// 2. Auth Handler with Manual CORS Injection & Logging
app.all("/api/auth/*", async (c) => {
  console.log(`[DEBUG] Auth Route Hit: ${c.req.path}`);
  const res = await auth.handler(c.req.raw);
  console.log(`[DEBUG] Auth Handler Status: ${res.status}`);
  
  const newRes = new Response(res.body, res);
  const origin = c.req.header("origin");
  const allowedOrigin = (origin?.endsWith(".vercel.app") || origin?.includes("localhost")) ? origin : env.CORS_ORIGIN;
  
  newRes.headers.set("Access-Control-Allow-Origin", allowedOrigin);
  newRes.headers.set("Access-Control-Allow-Credentials", "true");
  newRes.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  newRes.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-better-auth-api-key, better-auth-agent");
  return newRes;
});

app.options("*", (c) => {
  console.log(`[DEBUG] Explicit OPTIONS Preflight Hit: ${c.req.path}`);
  return c.text("", 204);
});

app.notFound((c) => {
  console.log(`[DEBUG] 404 Not Found: ${c.req.path}`);
  return c.json({ error: "Not Found", path: c.req.path }, 404);
});

app.onError((err, c) => {
  console.error(`[DEBUG] Server Error:`, err);
  return c.json({ error: "Internal Server Error", message: err.message }, 500);
});

app.get("/", (c) => c.text("OK"));
app.get("/health", (c) => c.json({ status: "ok", ts: new Date().toISOString() }));

// API key only ever read on the server. The browser hits /api/v1/* and never sees it.
app.route("/api/v1/runs", createRunsRouter(() => process.env.ANTHROPIC_API_KEY ?? null));
app.route("/api/v1/compare", compareRouter);
app.route("/api/v1/transcripts", transcriptsRouter);

export default {
  port: Number(process.env.PORT) || 8787,
  fetch: app.fetch,
};
