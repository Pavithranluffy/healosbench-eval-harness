import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, cases } from "@test-evals/db";
import type { AggregateScores, CompareResult } from "@test-evals/shared";
import { getRunSummary } from "../services/runner.service";

export const compareRouter = new Hono();

compareRouter.get("/", async (c) => {
  const a = c.req.query("a");
  const b = c.req.query("b");
  if (!a || !b) return c.json({ error: "missing a / b query param" }, 400);
  const [runA, runB] = await Promise.all([getRunSummary(a), getRunSummary(b)]);
  if (!runA || !runB) return c.json({ error: "run(s) not found" }, 404);

  const fields: Array<keyof AggregateScores> = [
    "chief_complaint",
    "vitals",
    "medications_f1",
    "diagnoses_f1",
    "plan_f1",
    "follow_up",
    "overall_f1",
  ];

  const aA = runA.aggregate;
  const aB = runB.aggregate;
  if (!aA || !aB) return c.json({ error: "one or both runs have no aggregate yet" }, 400);

  const per_field = fields.map((f) => {
    const av = aA[f] ?? 0;
    const bv = aB[f] ?? 0;
    const delta = bv - av;
    return {
      field: f,
      a: av,
      b: bv,
      delta,
      winner: Math.abs(delta) < 0.005 ? "tie" : (delta > 0 ? "b" : "a"),
    } as const;
  });

  // Per-case deltas joined on transcript_id (because case ids differ between runs).
  const [casesA, casesB] = await Promise.all([
    db.query.cases.findMany({ where: eq(cases.runId, runA.id) }),
    db.query.cases.findMany({ where: eq(cases.runId, runB.id) }),
  ]);
  const mapA = new Map(casesA.map((c) => [c.transcriptId, c.aggregateF1]));
  const mapB = new Map(casesB.map((c) => [c.transcriptId, c.aggregateF1]));
  const allTranscripts = new Set<string>([...mapA.keys(), ...mapB.keys()]);

  const per_case = [...allTranscripts].sort().map((tid) => {
    const av = mapA.get(tid) ?? null;
    const bv = mapB.get(tid) ?? null;
    const delta = (bv ?? 0) - (av ?? 0);
    return {
      case_id: tid,
      a_f1: av,
      b_f1: bv,
      delta,
      winner: Math.abs(delta) < 0.005 ? "tie" : (delta > 0 ? "b" : "a"),
    } as const;
  });

  const overall = per_field.find((f) => f.field === "overall_f1")!;
  const overall_winner = overall.winner;

  const result: CompareResult = {
    run_a: runA,
    run_b: runB,
    per_field: per_field as CompareResult["per_field"],
    per_case: per_case as CompareResult["per_case"],
    overall_winner,
  };
  return c.json(result);
});
