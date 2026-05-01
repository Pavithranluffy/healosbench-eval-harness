import { auth } from "@test-evals/auth";
import { env } from "@test-evals/env/server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { createRunsRouter } from "./routes/runs";
import { compareRouter } from "./routes/compare";
import { transcriptsRouter } from "./routes/transcripts";

const app = new Hono();

// 1. GLOBAL LOGGING FIRST
app.use("*", logger());

// 2. OFFICIAL CORS MIDDLEWARE (At the absolute top)
app.use("*", cors({
  origin: (origin) => {
    // Allow any Vercel subdomain or localhost
    if (!origin) return "https://healosbench-eval-harness.vercel.app";
    if (origin.endsWith(".vercel.app") || origin.includes("localhost") || origin === "https://healosbench-eval-harness.vercel.app") {
      return origin;
    }
    return "https://healosbench-eval-harness.vercel.app";
  },
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "x-better-auth-api-key", "better-auth-agent", "x-requested-with"],
  exposeHeaders: ["Content-Length", "X-Kuma-Revision"],
  maxAge: 600,
  credentials: true,
}));

// 3. DEBUG LOG FOR EVERY REQUEST
app.use("*", async (c, next) => {
  console.log(`[DEBUG] Incoming: ${c.req.method} ${c.req.url}`);
  await next();
  console.log(`[DEBUG] Outgoing: ${c.res.status} (Origin: ${c.req.header("Origin")})`);
});

// 4. AUTH HANDLER (Manual CORS wrap to be safe)
app.all("/api/auth/*", async (c) => {
  const res = await auth.handler(c.req.raw);
  // Clone the response to ensure we can set headers if the handler missed them
  const newRes = new Response(res.body, res);
  const origin = c.req.header("Origin") || "*";
  newRes.headers.set("Access-Control-Allow-Origin", origin);
  newRes.headers.set("Access-Control-Allow-Credentials", "true");
  return newRes;
});

// 5. DIAGNOSTIC ROUTE
app.get("/api/cors-test", (c) => c.json({ ok: true, origin: c.req.header("Origin") }));

// 6. APP ROUTES
app.get("/", (c) => c.text("HEALOSBENCH API OK"));
app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/api/v1/runs", createRunsRouter(() => process.env.ANTHROPIC_API_KEY ?? null));
app.route("/api/v1/compare", compareRouter);
app.route("/api/v1/transcripts", transcriptsRouter);

app.notFound((c) => {
  console.log(`[404] ${c.req.path}`);
  return c.json({ error: "Not Found", path: c.req.path }, 404);
});

export default {
  port: Number(process.env.PORT) || 8787,
  fetch: app.fetch,
};
