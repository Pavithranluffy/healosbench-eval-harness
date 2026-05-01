import { env } from "@test-evals/env/server";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

import * as schema from "./schema";

export * from "./schema";

export function createDb() {
  const sqlite = new Database(env.DATABASE_URL.replace("file:", ""));
  return drizzle(sqlite, { schema });
}

export const db = createDb();

/**
 * Creates all database tables if they don't already exist.
 * Uses CREATE TABLE IF NOT EXISTS so it is safe to call on every startup.
 */
export function runMigrations() {
  const sqlite = new Database(env.DATABASE_URL.replace("file:", ""));

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "user" (
      "id" text PRIMARY KEY NOT NULL,
      "name" text NOT NULL,
      "email" text NOT NULL UNIQUE,
      "email_verified" integer DEFAULT false NOT NULL,
      "image" text,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "session" (
      "id" text PRIMARY KEY NOT NULL,
      "expires_at" integer NOT NULL,
      "token" text NOT NULL UNIQUE,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL,
      "ip_address" text,
      "user_agent" text,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS "account" (
      "id" text PRIMARY KEY NOT NULL,
      "account_id" text NOT NULL,
      "provider_id" text NOT NULL,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "access_token" text,
      "refresh_token" text,
      "id_token" text,
      "access_token_expires_at" integer,
      "refresh_token_expires_at" integer,
      "scope" text,
      "password" text,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "verification" (
      "id" text PRIMARY KEY NOT NULL,
      "identifier" text NOT NULL,
      "value" text NOT NULL,
      "expires_at" integer NOT NULL,
      "created_at" integer NOT NULL,
      "updated_at" integer NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "eval_run" (
      "id" text PRIMARY KEY NOT NULL,
      "strategy" text NOT NULL,
      "model" text NOT NULL,
      "prompt_hash" text NOT NULL,
      "status" text NOT NULL DEFAULT 'pending',
      "dataset_filter" text,
      "total_cases" integer NOT NULL DEFAULT 0,
      "completed_cases" integer NOT NULL DEFAULT 0,
      "failed_cases" integer NOT NULL DEFAULT 0,
      "schema_invalid_count" integer NOT NULL DEFAULT 0,
      "hallucination_count" integer NOT NULL DEFAULT 0,
      "aggregate" text,
      "total_tokens_in" integer NOT NULL DEFAULT 0,
      "total_tokens_out" integer NOT NULL DEFAULT 0,
      "total_cache_read" integer NOT NULL DEFAULT 0,
      "total_cache_write" integer NOT NULL DEFAULT 0,
      "total_cost_usd" real NOT NULL DEFAULT 0,
      "duration_ms" integer NOT NULL DEFAULT 0,
      "error" text,
      "created_at" integer NOT NULL,
      "completed_at" integer
    );

    CREATE TABLE IF NOT EXISTS "eval_case" (
      "id" text PRIMARY KEY NOT NULL,
      "run_id" text NOT NULL REFERENCES "eval_run"("id") ON DELETE CASCADE,
      "transcript_id" text NOT NULL,
      "status" text NOT NULL DEFAULT 'pending',
      "prediction" text,
      "scores" text,
      "aggregate_f1" real,
      "schema_invalid" integer NOT NULL DEFAULT false,
      "hallucinations" text DEFAULT '[]',
      "tokens_in" integer NOT NULL DEFAULT 0,
      "tokens_out" integer NOT NULL DEFAULT 0,
      "cache_read" integer NOT NULL DEFAULT 0,
      "cache_write" integer NOT NULL DEFAULT 0,
      "cost_usd" real NOT NULL DEFAULT 0,
      "duration_ms" integer NOT NULL DEFAULT 0,
      "error" text,
      "created_at" integer NOT NULL,
      "completed_at" integer
    );

    CREATE TABLE IF NOT EXISTS "eval_attempt" (
      "id" text PRIMARY KEY NOT NULL,
      "case_id" text NOT NULL REFERENCES "eval_case"("id") ON DELETE CASCADE,
      "attempt" integer NOT NULL,
      "request" text,
      "response" text,
      "tokens_in" integer NOT NULL DEFAULT 0,
      "tokens_out" integer NOT NULL DEFAULT 0,
      "cache_read" integer NOT NULL DEFAULT 0,
      "cache_write" integer NOT NULL DEFAULT 0,
      "schema_valid" integer NOT NULL DEFAULT false,
      "validation_errors" text DEFAULT '[]',
      "duration_ms" integer NOT NULL DEFAULT 0,
      "created_at" integer NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "eval_idempotency" (
      "key" text PRIMARY KEY NOT NULL,
      "case_id" text NOT NULL REFERENCES "eval_case"("id") ON DELETE CASCADE,
      "created_at" integer NOT NULL
    );
  `);

  sqlite.close();
  console.log("[db] migrations applied successfully");
}
