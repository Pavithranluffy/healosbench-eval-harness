import { auth } from "@test-evals/auth";
import { env } from "@test-evals/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createRunsRouter } from "./routes/runs";
import { compareRouter } from "./routes/compare";
import { transcriptsRouter } from "./routes/transcripts";

const app = new Hono();

// 1. GLOBAL CORS - Must be first
app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-better-auth-api-key", "better-auth-agent"],
    credentials: true,
    exposeHeaders: ["Set-Cookie"],
  }),
);

app.use(logger());

// 2. Auth Handler with Manual CORS Injection
app.all("/api/auth/*", async (c) => {
  const res = await auth.handler(c.req.raw);
  const newRes = new Response(res.body, res);
  // Manually ensure CORS headers are present on auth responses
  newRes.headers.set("Access-Control-Allow-Origin", c.req.header("origin") || "*");
  newRes.headers.set("Access-Control-Allow-Credentials", "true");
  newRes.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  newRes.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-better-auth-api-key, better-auth-agent");
  return newRes;
});

app.options("*", (c) => c.text("", 204));

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
