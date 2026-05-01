// Mirror of @test-evals/shared types — duplicated because Next can't bundle
// workspace TS files easily without extra config. Keep these in sync.

export type Strategy = "zero_shot" | "few_shot" | "cot";
export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface AggregateScores {
  chief_complaint: number;
  vitals: number;
  medications_f1: number;
  diagnoses_f1: number;
  plan_f1: number;
  follow_up: number;
  overall_f1: number;
}

export interface RunSummary {
  id: string;
  strategy: Strategy;
  model: string;
  prompt_hash: string;
  status: RunStatus;
  created_at: string;
  completed_at: string | null;
  total_cases: number;
  completed_cases: number;
  failed_cases: number;
  schema_invalid_count: number;
  hallucination_count: number;
  aggregate: AggregateScores | null;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cache_read: number;
  total_cache_write: number;
  total_cost_usd: number;
  duration_ms: number;
}

export interface CaseRow {
  case_id: string;
  transcript_id: string;
  status: string;
  prediction: unknown;
  scores: unknown;
  aggregate_f1: number | null;
  schema_invalid: boolean;
  hallucinations: Array<{ field_path: string; value: string; reason: string }>;
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  cache_write: number;
  cost_usd: number;
  duration_ms: number;
  error: string | null;
}

export interface CompareResult {
  run_a: RunSummary;
  run_b: RunSummary;
  per_field: Array<{
    field: keyof AggregateScores;
    a: number;
    b: number;
    delta: number;
    winner: "a" | "b" | "tie";
  }>;
  per_case: Array<{ case_id: string; a_f1: number | null; b_f1: number | null; delta: number; winner: "a" | "b" | "tie" }>;
  overall_winner: "a" | "b" | "tie";
}
