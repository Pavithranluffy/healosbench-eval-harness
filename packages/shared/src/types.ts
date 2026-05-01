export type Strategy = "zero_shot" | "few_shot" | "cot";

export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type CaseStatus = "pending" | "running" | "completed" | "failed";

export interface Vitals {
  bp: string | null;
  hr: number | null;
  temp_f: number | null;
  spo2: number | null;
}

export interface Medication {
  name: string;
  dose: string | null;
  frequency: string | null;
  route: string | null;
}

export interface Diagnosis {
  description: string;
  icd10?: string;
}

export interface FollowUp {
  interval_days: number | null;
  reason: string | null;
}

export interface ClinicalExtraction {
  chief_complaint: string;
  vitals: Vitals;
  medications: Medication[];
  diagnoses: Diagnosis[];
  plan: string[];
  follow_up: FollowUp;
}

export interface FieldScores {
  chief_complaint: number;
  vitals: number;
  medications: { precision: number; recall: number; f1: number };
  diagnoses: { precision: number; recall: number; f1: number; icd10_bonus: number };
  plan: { precision: number; recall: number; f1: number };
  follow_up: number;
}

export interface CaseResult {
  case_id: string;
  transcript_id: string;
  status: CaseStatus;
  prediction: ClinicalExtraction | null;
  scores: FieldScores | null;
  aggregate_f1: number | null;
  schema_invalid: boolean;
  hallucinations: HallucinationFlag[];
  attempts: AttemptLog[];
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  cache_write: number;
  cost_usd: number;
  duration_ms: number;
  error: string | null;
}

export interface AttemptLog {
  attempt: number;
  request: unknown;
  response: unknown;
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  cache_write: number;
  schema_valid: boolean;
  validation_errors: string[];
  duration_ms: number;
}

export interface HallucinationFlag {
  field_path: string;
  value: string;
  reason: string;
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

export interface AggregateScores {
  chief_complaint: number;
  vitals: number;
  medications_f1: number;
  diagnoses_f1: number;
  plan_f1: number;
  follow_up: number;
  overall_f1: number;
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
  per_case: Array<{
    case_id: string;
    a_f1: number | null;
    b_f1: number | null;
    delta: number;
    winner: "a" | "b" | "tie";
  }>;
  overall_winner: "a" | "b" | "tie";
}
