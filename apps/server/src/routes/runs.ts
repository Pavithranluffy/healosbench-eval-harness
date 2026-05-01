import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  getCaseDetail,
  getRunBus,
  getRunSummary,
  listCases,
  listRuns,
  resumeRun,
  startRun,
} from "../services/runner.service";
import type { Strategy } from "@test-evals/shared";

const StartSchema = z.object({
  strategy: z.enum(["zero_shot", "few_shot", "cot"]),
  model: z.string().default("claude-haiku-4-5-20251001"),
  dataset_filter: z.array(z.string()).optional().nullable(),
  force: z.boolean().optional().default(false),
});

export function createRunsRouter(getApiKey: () => string | null | undefined) {
  const r = new Hono();

  r.get("/", async (c) => c.json(await listRuns()));

  r.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = StartSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { strategy, model, dataset_filter, force } = parsed.data;
    const { runId } = await startRun({
      strategy: strategy as Strategy,
      model,
      datasetFilter: dataset_filter ?? null,
      apiKey: getApiKey(),
      force,
    });
    return c.json({ run_id: runId }, 201);
  });

  r.get("/:id", async (c) => {
    const summary = await getRunSummary(c.req.param("id"));
    if (!summary) return c.json({ error: "not found" }, 404);
    return c.json(summary);
  });

  r.get("/:id/cases", async (c) => c.json(await listCases(c.req.param("id"))));

  r.get("/:id/events", (c) => {
    const id = c.req.param("id");
    const bus = getRunBus(id);
    return streamSSE(c, async (stream) => {
      const onCase = (e: unknown) => stream.writeSSE({ event: "case", data: JSON.stringify(e) });
      const onDone = (e: unknown) => stream.writeSSE({ event: "done", data: JSON.stringify(e) });
      const onError = (e: unknown) => stream.writeSSE({ event: "error", data: JSON.stringify(e) });
      bus.on("case", onCase);
      bus.on("done", onDone);
      bus.on("error", onError);

      // initial state push so reconnects are useful
      const summary = await getRunSummary(id);
      if (summary) await stream.writeSSE({ event: "state", data: JSON.stringify(summary) });

      // Keep open until aborted.
      await new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener("abort", () => {
          bus.off("case", onCase);
          bus.off("done", onDone);
          bus.off("error", onError);
          resolve();
        });
      });
    });
  });

  r.post("/:id/resume", async (c) => {
    const id = c.req.param("id");
    void resumeRun(id, { strategy: "zero_shot", model: "", apiKey: getApiKey() }).catch((e) =>
      console.error(`resume ${id} failed`, e),
    );
    return c.json({ resuming: id });
  });

  r.get("/cases/:caseId", async (c) => {
    const out = await getCaseDetail(c.req.param("caseId"));
    if (!out) return c.json({ error: "not found" }, 404);
    return c.json(out);
  });

  return r;
}
