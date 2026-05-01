/**
 * The runner.
 *
 * Concurrency:  Semaphore from @test-evals/llm caps in-flight LLM calls at 5.
 *               withBackoff handles 429/overloaded with jittered exponential
 *               backoff (honoring retry-after when present).
 * Resumability: Cases live in DB with status='pending'|'running'|'completed'|'failed'.
 *               Restart re-loads the run; resume() picks up any non-completed cases.
 *               No double-charging because completed rows are never re-sent.
 * Idempotency:  Key = sha256(model|strategy|prompt_hash|transcript_id). On repeat,
 *               return cached case row instead of calling the LLM. force=true bypasses.
 * Streaming:    EventEmitter per run; the SSE route subscribes and forwards events.
 */

import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, runs, cases, attempts as attemptsTbl, idempotency } from "@test-evals/db";
import { Semaphore, type Provider } from "@test-evals/llm";
import {
  computeCostUsd,
  type ClinicalExtraction,
  type Strategy,
  type RunSummary,
  type CaseResult,
  type AggregateScores,
} from "@test-evals/shared";
import { nanoid } from "nanoid";
import { loadCases, type Case } from "../lib/dataset";
import { runExtraction } from "./extract.service";
import {
  aggregateF1,
  aggregateRun,
  detectHallucinations,
  scorePrediction,
} from "./evaluate.service";

export interface StartRunInput {
  strategy: Strategy;
  model: string;
  datasetFilter?: string[] | null;
  apiKey?: string | null;
  /** Inject for tests. */
  provider?: Provider;
  /** Idempotency: when true, skips the cache check. */
  force?: boolean;
  /** When true, don't auto-execute — caller will call execute(runId) explicitly (used in tests). */
  deferExecution?: boolean;
  sleepFn?: (ms: number) => Promise<void>;
}

const RUN_BUS = new Map<string, EventEmitter>();

export function getRunBus(runId: string): EventEmitter {
  let bus = RUN_BUS.get(runId);
  if (!bus) {
    bus = new EventEmitter();
    bus.setMaxListeners(50);
    RUN_BUS.set(runId, bus);
  }
  return bus;
}

function idempotencyKey(model: string, strategy: Strategy, promptHash: string, transcriptId: string): string {
  return createHash("sha256")
    .update(`${model}|${strategy}|${promptHash}|${transcriptId}`)
    .digest("hex")
    .slice(0, 32);
}

export async function startRun(input: StartRunInput): Promise<{ runId: string }> {
  const allCases = await loadCases(input.datasetFilter);
  const runId = `run_${nanoid(10)}`;

  await db.insert(runs).values({
    id: runId,
    strategy: input.strategy,
    model: input.model,
    promptHash: "pending", // updated after first prompt resolution
    status: "pending",
    datasetFilter: input.datasetFilter ?? null,
    totalCases: allCases.length,
  });

  // Pre-create case rows; resumability + idempotency keys off these.
  const rows = allCases.map((c) => ({
    id: `case_${nanoid(10)}`,
    runId,
    transcriptId: c.id,
    status: "pending" as const,
  }));
  if (rows.length > 0) await db.insert(cases).values(rows);

  if (!input.deferExecution) {
    // Fire-and-forget; the API caller has already returned.
    void execute(runId, input).catch(async (err) => {
      console.error(`run ${runId} crashed:`, err);
      await db.update(runs).set({ status: "failed", error: String(err) }).where(eq(runs.id, runId));
      getRunBus(runId).emit("error", { runId, error: String(err) });
    });
  }

  return { runId };
}

export async function resumeRun(runId: string, input: Omit<StartRunInput, "datasetFilter">): Promise<void> {
  const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
  if (!run) throw new Error(`run ${runId} not found`);
  if (run.status === "completed") return;
  await db.update(runs).set({ status: "running", error: null }).where(eq(runs.id, runId));
  await execute(runId, {
    ...input,
    strategy: run.strategy as Strategy,
    model: run.model,
    datasetFilter: run.datasetFilter,
  });
}

async function execute(runId: string, input: StartRunInput): Promise<void> {
  const start = Date.now();
  await db.update(runs).set({ status: "running" }).where(eq(runs.id, runId));

  const allCaseRows = await db.query.cases.findMany({ where: eq(cases.runId, runId) });
  const allCases = await loadCases(allCaseRows.map((c) => c.transcriptId));
  const caseById = new Map<string, Case>(allCases.map((c) => [c.id, c]));

  // Only process cases that aren't already completed (resumability).
  const pending = allCaseRows.filter((c) => c.status !== "completed");

  const semaphore = new Semaphore(5);
  const bus = getRunBus(runId);

  // Track aggregate stats incrementally so the SSE stream can show progress.
  let totalIn = 0,
    totalOut = 0,
    totalCacheRead = 0,
    totalCacheWrite = 0,
    totalCost = 0,
    completed = 0,
    failed = 0,
    schemaInvalidCount = 0,
    hallucinationCount = 0;

  await Promise.all(
    pending.map(async (caseRow) => {
      const release = await semaphore.acquire();
      try {
        const dataCase = caseById.get(caseRow.transcriptId);
        if (!dataCase) {
          await markCaseFailed(caseRow.id, `transcript ${caseRow.transcriptId} not on disk`);
          failed++;
          return;
        }

        // Idempotency check: if a previously-completed case row for the same
        // (model, strategy, prompt_hash, transcript) exists, copy its result.
        const promptHashEarly = (await import("@test-evals/llm")).getStrategy(input.strategy).hash();
        const idemKey = idempotencyKey(input.model, input.strategy, promptHashEarly, dataCase.id);
        if (!input.force) {
          const cached = await db.query.idempotency.findFirst({
            where: eq(idempotency.key, idemKey),
          });
          if (cached) {
            const src = await db.query.cases.findFirst({ where: eq(cases.id, cached.caseId) });
            if (src && src.status === "completed") {
              await db.update(cases).set({
                status: "completed",
                prediction: src.prediction,
                scores: src.scores,
                aggregateF1: src.aggregateF1,
                schemaInvalid: src.schemaInvalid,
                hallucinations: src.hallucinations,
                tokensIn: 0,
                tokensOut: 0,
                cacheRead: 0,
                cacheWrite: 0,
                costUsd: 0,
                durationMs: 0,
                completedAt: new Date(),
              }).where(eq(cases.id, caseRow.id));
              completed++;
              if (src.schemaInvalid) schemaInvalidCount++;
              hallucinationCount += (src.hallucinations as unknown[] | null)?.length ?? 0;
              bus.emit("case", { runId, caseId: caseRow.id, status: "completed", cached: true, transcriptId: dataCase.id });
              return;
            }
          }
        }

        await db.update(cases).set({ status: "running" }).where(eq(cases.id, caseRow.id));

        const result = await runExtraction({
          strategy: input.strategy,
          model: input.model,
          transcript: dataCase.transcript,
          gold: dataCase.gold,
          apiKey: input.apiKey,
          provider: input.provider,
          sleepFn: input.sleepFn,
        });

        // Persist attempt logs.
        for (const a of result.attempts) {
          await db.insert(attemptsTbl).values({
            id: `att_${nanoid(10)}`,
            caseId: caseRow.id,
            attempt: a.attempt,
            request: a.request,
            response: a.response,
            tokensIn: a.tokens_in,
            tokensOut: a.tokens_out,
            cacheRead: a.cache_read,
            cacheWrite: a.cache_write,
            schemaValid: a.schema_valid,
            validationErrors: a.validation_errors,
            durationMs: a.duration_ms,
          });
        }

        const prediction = result.prediction;
        const scores = prediction ? scorePrediction(prediction, dataCase.gold) : null;
        const aggregate = scores ? aggregateF1(scores) : null;
        const halls = prediction ? detectHallucinations(prediction, dataCase.transcript) : [];

        const cost = computeCostUsd(input.model, {
          input_tokens: result.total_input_tokens,
          output_tokens: result.total_output_tokens,
          cache_creation_input_tokens: result.total_cache_write,
          cache_read_input_tokens: result.total_cache_read,
        });

        await db.update(cases).set({
          status: "completed",
          prediction: prediction as ClinicalExtraction | null,
          scores,
          aggregateF1: aggregate,
          schemaInvalid: result.schema_invalid,
          hallucinations: halls,
          tokensIn: result.total_input_tokens,
          tokensOut: result.total_output_tokens,
          cacheRead: result.total_cache_read,
          cacheWrite: result.total_cache_write,
          costUsd: cost,
          durationMs: result.duration_ms,
          completedAt: new Date(),
        }).where(eq(cases.id, caseRow.id));

        // Record idempotency entry on success.
        await db.insert(idempotency).values({ key: idemKey, caseId: caseRow.id }).onConflictDoNothing();

        completed++;
        if (result.schema_invalid) schemaInvalidCount++;
        hallucinationCount += halls.length;
        totalIn += result.total_input_tokens;
        totalOut += result.total_output_tokens;
        totalCacheRead += result.total_cache_read;
        totalCacheWrite += result.total_cache_write;
        totalCost += cost;

        bus.emit("case", {
          runId,
          caseId: caseRow.id,
          status: "completed",
          transcriptId: dataCase.id,
          aggregate,
          cache_read: result.total_cache_read,
        });
      } catch (err) {
        await markCaseFailed(caseRow.id, String(err));
        failed++;
        bus.emit("case", { runId, caseId: caseRow.id, status: "failed", error: String(err) });
      } finally {
        release();
      }
    }),
  );

  // Final aggregation across all completed cases on this run.
  const finalCases = await db.query.cases.findMany({ where: eq(cases.runId, runId) });
  const completedRows = finalCases.filter((c) => c.status === "completed");
  const aggregate = aggregateRun(
    completedRows.map((r) => caseRowToCaseResult(r)),
  );

  const promptHash = (await import("@test-evals/llm")).getStrategy(input.strategy).hash();

  await db.update(runs).set({
    status: failed > 0 && completed === 0 ? "failed" : "completed",
    completedCases: completed,
    failedCases: failed,
    schemaInvalidCount,
    hallucinationCount,
    aggregate,
    totalTokensIn: totalIn,
    totalTokensOut: totalOut,
    totalCacheRead: totalCacheRead,
    totalCacheWrite: totalCacheWrite,
    totalCostUsd: totalCost,
    durationMs: Date.now() - start,
    completedAt: new Date(),
    promptHash,
  }).where(eq(runs.id, runId));

  bus.emit("done", { runId, aggregate });
}

async function markCaseFailed(caseId: string, error: string): Promise<void> {
  await db.update(cases)
    .set({ status: "failed", error, completedAt: new Date() })
    .where(eq(cases.id, caseId));
}

function caseRowToCaseResult(row: typeof cases.$inferSelect): CaseResult {
  return {
    case_id: row.id,
    transcript_id: row.transcriptId,
    status: row.status as CaseResult["status"],
    prediction: row.prediction as ClinicalExtraction | null,
    scores: row.scores as CaseResult["scores"],
    aggregate_f1: row.aggregateF1,
    schema_invalid: row.schemaInvalid,
    hallucinations: (row.hallucinations as CaseResult["hallucinations"]) ?? [],
    attempts: [],
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cache_read: row.cacheRead,
    cache_write: row.cacheWrite,
    cost_usd: row.costUsd,
    duration_ms: row.durationMs,
    error: row.error,
  };
}

export async function getRunSummary(runId: string): Promise<RunSummary | null> {
  const run = await db.query.runs.findFirst({ where: eq(runs.id, runId) });
  if (!run) return null;
  return {
    id: run.id,
    strategy: run.strategy as Strategy,
    model: run.model,
    prompt_hash: run.promptHash,
    status: run.status as RunSummary["status"],
    created_at: run.createdAt.toISOString(),
    completed_at: run.completedAt?.toISOString() ?? null,
    total_cases: run.totalCases,
    completed_cases: run.completedCases,
    failed_cases: run.failedCases,
    schema_invalid_count: run.schemaInvalidCount,
    hallucination_count: run.hallucinationCount,
    aggregate: (run.aggregate as AggregateScores | null) ?? null,
    total_tokens_in: run.totalTokensIn,
    total_tokens_out: run.totalTokensOut,
    total_cache_read: run.totalCacheRead,
    total_cache_write: run.totalCacheWrite,
    total_cost_usd: run.totalCostUsd,
    duration_ms: run.durationMs,
  };
}

export async function listRuns(): Promise<RunSummary[]> {
  const all = await db.query.runs.findMany({ orderBy: (r, { desc }) => desc(r.createdAt) });
  return Promise.all(all.map((r) => getRunSummary(r.id))) as Promise<RunSummary[]>;
}

export async function listCases(runId: string): Promise<CaseResult[]> {
  const rows = await db.query.cases.findMany({ where: eq(cases.runId, runId) });
  return rows.map(caseRowToCaseResult);
}

export async function getCaseDetail(caseId: string): Promise<{ case: CaseResult; attempts: unknown[] } | null> {
  const c = await db.query.cases.findFirst({ where: eq(cases.id, caseId) });
  if (!c) return null;
  const atts = await db.query.attempts.findMany({ where: eq(attemptsTbl.caseId, caseId) });
  return { case: caseRowToCaseResult(c), attempts: atts };
}

export { idempotencyKey };

// Surface for tests:
export const _internal = { execute, idempotencyKey, RUN_BUS };
