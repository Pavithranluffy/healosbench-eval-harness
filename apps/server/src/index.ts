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

// 1. Hyper-Permissive CORS Middleware
app.use("*", async (c, next) => {
  const origin = c.req.header("Origin") || "*";
  
  // Set headers BEFORE the request is processed
  c.header("Access-Control-Allow-Origin", origin);
  c.header("Access-Control-Allow-Credentials", "true");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-better-auth-api-key, better-auth-agent, x-requested-with");

  if (c.req.method === "OPTIONS") {
    return c.text("", 204);
  }

  await next();

  // Re-verify headers AFTER the request is processed (in case they were overwritten)
  c.header("Access-Control-Allow-Origin", origin);
  c.header("Access-Control-Allow-Credentials", "true");
});

app.use(logger());

// Diagnostic route
app.get("/api/cors-test", (c) => {
  return c.json({ message: "CORS is working", origin: c.req.header("Origin") });
});

app.all("/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

app.notFound((c) => {
  return c.json({ error: "Not Found", path: c.req.path }, 404);
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

app.get("/", (c) => c.text("OK"));
app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/api/v1/runs", createRunsRouter(() => process.env.ANTHROPIC_API_KEY ?? null));
app.route("/api/v1/compare", compareRouter);
app.route("/api/v1/transcripts", transcriptsRouter);

export default {
  port: Number(process.env.PORT) || 8787,
  fetch: app.fetch,
};
