import { relations } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
} from "drizzle-orm/sqlite-core";

export const runs = sqliteTable(
  "eval_run",
  {
    id: text("id").primaryKey(),
    strategy: text("strategy").notNull(),
    model: text("model").notNull(),
    promptHash: text("prompt_hash").notNull(),
    status: text("status").notNull().default("pending"),
    datasetFilter: text("dataset_filter", { mode: "json" }).$type<string[] | null>(),
    totalCases: integer("total_cases").notNull().default(0),
    completedCases: integer("completed_cases").notNull().default(0),
    failedCases: integer("failed_cases").notNull().default(0),
    schemaInvalidCount: integer("schema_invalid_count").notNull().default(0),
    hallucinationCount: integer("hallucination_count").notNull().default(0),
    aggregate: text("aggregate", { mode: "json" }).$type<unknown>(),
    totalTokensIn: integer("total_tokens_in").notNull().default(0),
    totalTokensOut: integer("total_tokens_out").notNull().default(0),
    totalCacheRead: integer("total_cache_read").notNull().default(0),
    totalCacheWrite: integer("total_cache_write").notNull().default(0),
    totalCostUsd: real("total_cost_usd").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  }
);

export const cases = sqliteTable(
  "eval_case",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    transcriptId: text("transcript_id").notNull(),
    status: text("status").notNull().default("pending"),
    prediction: text("prediction", { mode: "json" }).$type<unknown>(),
    scores: text("scores", { mode: "json" }).$type<unknown>(),
    aggregateF1: real("aggregate_f1"),
    schemaInvalid: integer("schema_invalid", { mode: "boolean" }).notNull().default(false),
    hallucinations: text("hallucinations", { mode: "json" }).$type<unknown[]>().default([]),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    cacheRead: integer("cache_read").notNull().default(0),
    cacheWrite: integer("cache_write").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  }
);

export const attempts = sqliteTable(
  "eval_attempt",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    request: text("request", { mode: "json" }).$type<unknown>(),
    response: text("response", { mode: "json" }).$type<unknown>(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    cacheRead: integer("cache_read").notNull().default(0),
    cacheWrite: integer("cache_write").notNull().default(0),
    schemaValid: integer("schema_valid", { mode: "boolean" }).notNull().default(false),
    validationErrors: text("validation_errors", { mode: "json" }).$type<string[]>().default([]),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(new Date()),
  }
);

/**
 * Idempotency cache: keyed on (model, strategy, prompt_hash, transcript_id).
 * Two POST /api/v1/runs with the same triple reuse the cached prediction
 * unless `force=true` is set.
 */
export const idempotency = sqliteTable(
  "eval_idempotency",
  {
    key: text("key").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(new Date()),
  }
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
