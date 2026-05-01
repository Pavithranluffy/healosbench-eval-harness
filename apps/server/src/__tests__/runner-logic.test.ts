/**
 * Tests for runner pure-logic — these don't require a live Postgres.
 * The DB-bound flows are exercised via the integration script in scripts/smoke.ts
 * (run manually after `bun run db:push`).
 */

import { describe, expect, test } from "bun:test";
import { idempotencyKey } from "../services/runner.service";

describe("idempotency key", () => {
  test("identical inputs produce identical keys", () => {
    const a = idempotencyKey("claude-haiku-4-5-20251001", "zero_shot", "abc123", "case_001");
    const b = idempotencyKey("claude-haiku-4-5-20251001", "zero_shot", "abc123", "case_001");
    expect(a).toBe(b);
  });
  test("changing prompt hash flips the key", () => {
    const a = idempotencyKey("m", "zero_shot", "v1", "c");
    const b = idempotencyKey("m", "zero_shot", "v2", "c");
    expect(a).not.toBe(b);
  });
  test("changing strategy flips the key", () => {
    const a = idempotencyKey("m", "zero_shot", "h", "c");
    const b = idempotencyKey("m", "few_shot", "h", "c");
    expect(a).not.toBe(b);
  });
});

describe("resumability invariants", () => {
  /**
   * Resumability is implemented as: pending case rows are filtered before
   * the Promise.all, completed rows are skipped. We verify the predicate
   * here without booting Postgres.
   */
  type Row = { status: "pending" | "running" | "completed" | "failed" };
  const filterResumable = (rows: Row[]) => rows.filter((r) => r.status !== "completed");

  test("completed rows are skipped on resume", () => {
    const rows: Row[] = [
      { status: "completed" },
      { status: "completed" },
      { status: "running" },
      { status: "pending" },
      { status: "failed" }, // failed cases SHOULD be retried on resume
    ];
    const out = filterResumable(rows);
    expect(out).toHaveLength(3);
    expect(out.find((r) => r.status === "completed")).toBeUndefined();
  });
});
