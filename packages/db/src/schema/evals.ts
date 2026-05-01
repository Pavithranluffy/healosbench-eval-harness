import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";

export const runs = pgTable(
  "eval_run",
  {
    id: text("id").primaryKey(),
    strategy: text("strategy").notNull(),
    model: text("model").notNull(),
    promptHash: text("prompt_hash").notNull(),
    status: text("status").notNull().default("pending"),
    datasetFilter: jsonb("dataset_filter").$type<string[] | null>(),
    totalCases: integer("total_cases").notNull().default(0),
    completedCases: integer("completed_cases").notNull().default(0),
    failedCases: integer("failed_cases").notNull().default(0),
    schemaInvalidCount: integer("schema_invalid_count").notNull().default(0),
    hallucinationCount: integer("hallucination_count").notNull().default(0),
    aggregate: jsonb("aggregate").$type<unknown>(),
    totalTokensIn: integer("total_tokens_in").notNull().default(0),
    totalTokensOut: integer("total_tokens_out").notNull().default(0),
    totalCacheRead: integer("total_cache_read").notNull().default(0),
    totalCacheWrite: integer("total_cache_write").notNull().default(0),
    totalCostUsd: doublePrecision("total_cost_usd").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [index("eval_run_status_idx").on(t.status), index("eval_run_strategy_idx").on(t.strategy)],
);

export const cases = pgTable(
  "eval_case",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    transcriptId: text("transcript_id").notNull(),
    status: text("status").notNull().default("pending"),
    prediction: jsonb("prediction").$type<unknown>(),
    scores: jsonb("scores").$type<unknown>(),
    aggregateF1: doublePrecision("aggregate_f1"),
    schemaInvalid: boolean("schema_invalid").notNull().default(false),
    hallucinations: jsonb("hallucinations").$type<unknown[]>().default([]),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    cacheRead: integer("cache_read").notNull().default(0),
    cacheWrite: integer("cache_write").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("eval_case_run_idx").on(t.runId),
    uniqueIndex("eval_case_run_transcript_uq").on(t.runId, t.transcriptId),
  ],
);

export const attempts = pgTable(
  "eval_attempt",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    request: jsonb("request").$type<unknown>(),
    response: jsonb("response").$type<unknown>(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    cacheRead: integer("cache_read").notNull().default(0),
    cacheWrite: integer("cache_write").notNull().default(0),
    schemaValid: boolean("schema_valid").notNull().default(false),
    validationErrors: jsonb("validation_errors").$type<string[]>().default([]),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("eval_attempt_case_idx").on(t.caseId)],
);

/**
 * Idempotency cache: keyed on (model, strategy, prompt_hash, transcript_id).
 * Two POST /api/v1/runs with the same triple reuse the cached prediction
 * unless `force=true` is set.
 */
export const idempotency = pgTable(
  "eval_idempotency",
  {
    key: text("key").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("eval_idempotency_case_idx").on(t.caseId)],
);

export const runsRelations = relations(runs, ({ many }) => ({
  cases: many(cases),
}));

export const casesRelations = relations(cases, ({ one, many }) => ({
  run: one(runs, { fields: [cases.runId], references: [runs.id] }),
  attempts: many(attempts),
}));

export const attemptsRelations = relations(attempts, ({ one }) => ({
  case: one(cases, { fields: [attempts.caseId], references: [cases.id] }),
}));
