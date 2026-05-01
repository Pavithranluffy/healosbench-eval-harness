import { auth } from "@test-evals/auth";
import { env } from "@test-evals/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createRunsRouter } from "./routes/runs";
import { compareRouter } from "./routes/compare";
import { transcriptsRouter } from "./routes/transcripts";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: (origin) => {
      // Allow exact match or match without trailing slash
      if (!origin) return null;
      const cleanOrigin = env.CORS_ORIGIN.replace(/\/$/, "");
      if (origin === cleanOrigin || origin === env.CORS_ORIGIN) {
        return origin;
      }
      return null;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-better-auth-api-key"],
    credentials: true,
    exposeHeaders: ["set-cookie"],
  }),
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

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
