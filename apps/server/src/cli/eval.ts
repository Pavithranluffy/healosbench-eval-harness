#!/usr/bin/env bun
/**
 * CLI eval — runs a full N-case evaluation without the dashboard / DB.
 *
 *   bun run eval -- --strategy=zero_shot
 *   bun run eval -- --strategy=cot --model=claude-haiku-4-5-20251001
 *   bun run eval -- --strategy=few_shot --limit=10 --json results/few_shot.json
 *   bun run eval -- --all                  # runs all 3 strategies
 *
 * If ANTHROPIC_API_KEY isn't set, falls back to the mock provider so the
 * harness still exercises end-to-end (zero scores, but proves wiring).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AnthropicProvider,
  MockProvider,
  extract,
  getStrategy,
  type Provider,
} from "@test-evals/llm";
import {
  computeCostUsd,
  type Strategy,
  type ClinicalExtraction,
  type CaseResult,
} from "@test-evals/shared";
import { loadCases } from "../lib/dataset";
import {
  aggregateF1,
  aggregateRun,
  detectHallucinations,
  scorePrediction,
} from "../services/evaluate.service";
import { Semaphore } from "@test-evals/llm";

interface CliOptions {
  strategies: Strategy[];
  model: string;
  limit?: number;
  out?: string;
  apiKey?: string;
  concurrency: number;
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let strategies: Strategy[] = [];
  let model = "claude-haiku-4-5-20251001";
  let limit: number | undefined;
  let out: string | undefined;
  let concurrency = 5;
  let runAll = false;

  for (const a of args) {
    if (a.startsWith("--strategy=")) strategies = [a.split("=")[1] as Strategy];
    else if (a.startsWith("--model=")) model = a.split("=")[1] ?? model;
    else if (a.startsWith("--limit=")) limit = Number(a.split("=")[1]);
    else if (a.startsWith("--json=") || a.startsWith("--out=")) out = a.split("=")[1];
    else if (a.startsWith("--concurrency=")) concurrency = Number(a.split("=")[1]);
    else if (a === "--all") runAll = true;
  }
  if (runAll) strategies = ["zero_shot", "few_shot", "cot"];
  if (strategies.length === 0) {
    console.error("usage: bun run eval -- --strategy=zero_shot|few_shot|cot [--model=...] [--limit=N] [--out=results/x.json] [--all]");
    process.exit(1);
  }
  return { strategies, model, limit, out, apiKey: process.env.ANTHROPIC_API_KEY, concurrency };
}

function fmt(n: number, digits = 3): string {
  return n.toFixed(digits);
}

async function runOneStrategy(strategy: Strategy, opts: CliOptions): Promise<{
  strategy: Strategy;
  results: CaseResult[];
  totals: {
    in: number; out: number; cacheRead: number; cacheWrite: number; cost: number; durationMs: number;
    schemaInvalid: number; halls: number;
  };
}> {
  const start = Date.now();
  const allCases = await loadCases();
  const cases = opts.limit ? allCases.slice(0, opts.limit) : allCases;

  const provider: Provider = opts.apiKey
    ? new AnthropicProvider({ apiKey: opts.apiKey })
    : new MockProvider({
        // Cycle: feed the gold back as the "prediction" so wiring is exercised.
        responses: cases.map((c) => ({ tool_input: c.gold, stop_reason: "tool_use" })),
      });

  const semaphore = new Semaphore(opts.concurrency);
  const results: CaseResult[] = [];
  let totIn = 0, totOut = 0, totCR = 0, totCW = 0, totCost = 0, schemaInvalid = 0, hallucinations = 0;

  const stratObj = getStrategy(strategy);
  console.log(`\n=== ${strategy} (hash ${stratObj.hash()}) — ${cases.length} cases @ ${opts.model} ===`);

  await Promise.all(cases.map(async (c, idx) => {
    const release = await semaphore.acquire();
    try {
      const r = await extract({ provider, strategy: stratObj, model: opts.model, transcript: c.transcript });
      const prediction = r.prediction;
      const scores = prediction ? scorePrediction(prediction, c.gold) : null;
      const aggregate = scores ? aggregateF1(scores) : null;
      const halls = prediction ? detectHallucinations(prediction, c.transcript) : [];
      const cost = computeCostUsd(opts.model, {
        input_tokens: r.total_input_tokens,
        output_tokens: r.total_output_tokens,
        cache_creation_input_tokens: r.total_cache_write,
        cache_read_input_tokens: r.total_cache_read,
      });
      totIn += r.total_input_tokens;
      totOut += r.total_output_tokens;
      totCR += r.total_cache_read;
      totCW += r.total_cache_write;
      totCost += cost;
      if (r.schema_invalid) schemaInvalid++;
      hallucinations += halls.length;

      results.push({
        case_id: c.id,
        transcript_id: c.id,
        status: r.schema_invalid ? "failed" : "completed",
        prediction: prediction as ClinicalExtraction | null,
        scores,
        aggregate_f1: aggregate,
        schema_invalid: r.schema_invalid,
        hallucinations: halls,
        attempts: r.attempts,
        tokens_in: r.total_input_tokens,
        tokens_out: r.total_output_tokens,
        cache_read: r.total_cache_read,
        cache_write: r.total_cache_write,
        cost_usd: cost,
        duration_ms: r.duration_ms,
        error: null,
      });
      const f1Str = aggregate == null ? "INVALID" : fmt(aggregate);
      const cacheNote = r.total_cache_read > 0 ? ` cache_read=${r.total_cache_read}` : "";
      console.log(`  [${idx + 1}/${cases.length}] ${c.id}  f1=${f1Str}  halls=${halls.length}${cacheNote}`);
    } catch (err) {
      console.error(`  [${idx + 1}/${cases.length}] ${c.id} ERROR ${String(err)}`);
      results.push({
        case_id: c.id,
        transcript_id: c.id,
        status: "failed",
        prediction: null,
        scores: null,
        aggregate_f1: null,
        schema_invalid: true,
        hallucinations: [],
        attempts: [],
        tokens_in: 0,
        tokens_out: 0,
        cache_read: 0,
        cache_write: 0,
        cost_usd: 0,
        duration_ms: 0,
        error: String(err),
      });
    } finally {
      release();
    }
  }));

  return {
    strategy,
    results: results.sort((a, b) => a.case_id.localeCompare(b.case_id)),
    totals: {
      in: totIn, out: totOut, cacheRead: totCR, cacheWrite: totCW, cost: totCost,
      durationMs: Date.now() - start, schemaInvalid, halls: hallucinations,
    },
  };
}

function printSummaryTable(rows: Array<Awaited<ReturnType<typeof runOneStrategy>>>): void {
  const agg = rows.map((r) => ({
    strategy: r.strategy,
    aggregate: aggregateRun(r.results),
    totals: r.totals,
  }));

  console.log("\n┌───────────┬──────┬──────┬──────┬──────┬──────┬──────┬────────┬───────┬──────┬──────┬─────────┐");
  console.log("│ strategy  │ CC   │ vitals│ meds │ dx   │ plan │ FU   │ overall│ halls │ inv  │ cost │ duration│");
  console.log("├───────────┼──────┼──────┼──────┼──────┼──────┼──────┼────────┼───────┼──────┼──────┼─────────┤");
  for (const a of agg) {
    const ag = a.aggregate;
    console.log(
      `│ ${a.strategy.padEnd(9)} │ ${fmt(ag.chief_complaint, 2)} │ ${fmt(ag.vitals, 2)} │ ${fmt(ag.medications_f1, 2)} │ ${fmt(ag.diagnoses_f1, 2)} │ ${fmt(ag.plan_f1, 2)} │ ${fmt(ag.follow_up, 2)} │ ${fmt(ag.overall_f1, 3).padStart(6)} │ ${String(a.totals.halls).padStart(5)} │ ${String(a.totals.schemaInvalid).padStart(4)} │ $${a.totals.cost.toFixed(3).padStart(4)} │ ${(a.totals.durationMs / 1000).toFixed(1).padStart(6)}s │`,
    );
  }
  console.log("└───────────┴──────┴──────┴──────┴──────┴──────┴──────┴────────┴───────┴──────┴──────┴─────────┘");

  if (agg.length >= 2) {
    console.log("\nCompare deltas (relative to first strategy):");
    const base = agg[0]!.aggregate;
    for (let i = 1; i < agg.length; i++) {
      const cur = agg[i]!;
      console.log(`  ${cur.strategy} vs ${agg[0]!.strategy}:`);
      const fields = ["chief_complaint", "vitals", "medications_f1", "diagnoses_f1", "plan_f1", "follow_up", "overall_f1"] as const;
      for (const f of fields) {
        const d = cur.aggregate[f] - base[f];
        const arrow = d > 0.005 ? "↑" : d < -0.005 ? "↓" : "·";
        console.log(`    ${arrow} ${f.padEnd(18)} ${(d > 0 ? "+" : "") + fmt(d, 3)}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  if (!opts.apiKey) {
    console.warn("⚠  ANTHROPIC_API_KEY not set — using MockProvider (echoes gold). Set the key for real evals.");
  }

  const rows: Awaited<ReturnType<typeof runOneStrategy>>[] = [];
  for (const s of opts.strategies) rows.push(await runOneStrategy(s, opts));

  printSummaryTable(rows);

  if (opts.out) {
    const path = opts.out;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify(
        rows.map((r) => ({
          strategy: r.strategy,
          totals: r.totals,
          aggregate: aggregateRun(r.results),
          per_case: r.results.map((c) => ({
            id: c.case_id,
            f1: c.aggregate_f1,
            scores: c.scores,
            schema_invalid: c.schema_invalid,
            hallucinations: c.hallucinations,
          })),
        })),
        null,
        2,
      ),
    );
    console.log(`\n✓ wrote ${path}`);
  } else {
    // Default: write per-strategy JSON to results/
    for (const r of rows) {
      const path = join(process.cwd(), "results", `${r.strategy}-${Date.now()}.json`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify({
        strategy: r.strategy,
        totals: r.totals,
        aggregate: aggregateRun(r.results),
        per_case: r.results,
      }, null, 2));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
