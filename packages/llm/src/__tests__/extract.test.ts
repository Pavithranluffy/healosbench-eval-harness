import { describe, expect, test } from "bun:test";
import { MockProvider } from "../mock";
import { extract } from "../extract";
import { getStrategy } from "../strategies";
import { isRateLimitError, withBackoff } from "../rate-limit";

const validPrediction = {
  chief_complaint: "test",
  vitals: { bp: null, hr: null, temp_f: null, spo2: null },
  medications: [],
  diagnoses: [],
  plan: ["follow up"],
  follow_up: { interval_days: null, reason: null },
};

describe("extract: schema-validation retry path", () => {
  test("retries with feedback when first response is schema-invalid, succeeds on attempt 2", async () => {
    const provider = new MockProvider({
      responses: [
        { tool_input: { chief_complaint: "x" /* missing required fields */ } },
        { tool_input: validPrediction },
      ],
    });

    const result = await extract({
      provider,
      strategy: getStrategy("zero_shot"),
      model: "claude-haiku-4-5-20251001",
      transcript: "patient has cough",
      maxAttempts: 3,
    });

    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]!.schema_valid).toBe(false);
    expect(result.attempts[0]!.validation_errors.length).toBeGreaterThan(0);
    expect(result.attempts[1]!.schema_valid).toBe(true);
    expect(result.schema_invalid).toBe(false);
    expect(result.prediction?.chief_complaint).toBe("test");

    // Second request should include the prior tool_use + tool_result feedback turn.
    expect(provider.requests).toHaveLength(2);
    const secondMsgs = provider.requests[1]!.messages;
    expect(secondMsgs.length).toBeGreaterThan(1);
    const stringified = JSON.stringify(secondMsgs);
    expect(stringified).toContain("tool_result");
    expect(stringified).toContain("VALIDATION ERRORS");
  });

  test("gives up after maxAttempts and reports schema_invalid", async () => {
    const provider = new MockProvider({
      responses: [
        { tool_input: { chief_complaint: "x" } },
        { tool_input: { chief_complaint: "x" } },
        { tool_input: { chief_complaint: "x" } },
      ],
    });

    const result = await extract({
      provider,
      strategy: getStrategy("zero_shot"),
      model: "claude-haiku-4-5-20251001",
      transcript: "...",
      maxAttempts: 3,
    });
    expect(result.attempts).toHaveLength(3);
    expect(result.schema_invalid).toBe(true);
    expect(result.prediction).toBeNull();
  });
});

describe("rate limit handling", () => {
  test("isRateLimitError detects 429", () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ status: 529 })).toBe(true);
    expect(isRateLimitError({ error: { type: "overloaded_error" } })).toBe(true);
    expect(isRateLimitError({ message: "429 too many requests" })).toBe(true);
    expect(isRateLimitError(new Error("connection reset"))).toBe(false);
  });

  test("withBackoff retries on 429 then succeeds", async () => {
    let calls = 0;
    const slept: number[] = [];
    const out = await withBackoff(
      async () => {
        calls++;
        if (calls < 3) {
          const err = Object.assign(new Error("rate limit"), { status: 429 });
          throw err;
        }
        return "ok";
      },
      { maxRetries: 5, baseMs: 1, sleepFn: async (ms) => { slept.push(ms); } },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
    expect(slept).toHaveLength(2);
  });

  test("withBackoff propagates non-rate-limit errors immediately", async () => {
    let calls = 0;
    await expect(withBackoff(
      async () => { calls++; throw new Error("boom"); },
      { sleepFn: async () => {} },
    )).rejects.toThrow("boom");
    expect(calls).toBe(1);
  });
});

describe("prompt hash stability", () => {
  test("same strategy → same hash; different strategy → different hash", () => {
    const z1 = getStrategy("zero_shot").hash();
    const z2 = getStrategy("zero_shot").hash();
    const f = getStrategy("few_shot").hash();
    const c = getStrategy("cot").hash();
    expect(z1).toBe(z2);
    expect(z1).not.toBe(f);
    expect(z1).not.toBe(c);
    expect(f).not.toBe(c);
  });

  test("hash is sensitive to prompt content", async () => {
    const { promptHash } = await import("@test-evals/shared");
    expect(promptHash("a")).not.toBe(promptHash("b"));
    expect(promptHash("hello", "world")).not.toBe(promptHash("hello world"));
  });
});

describe("cache control headers", () => {
  test("system prompt blocks are sent with cache_control: ephemeral", async () => {
    const provider = new MockProvider({ responses: [{ tool_input: validPrediction }] });
    await extract({
      provider,
      strategy: getStrategy("few_shot"),
      model: "claude-haiku-4-5-20251001",
      transcript: "patient has cough",
    });
    const sys = provider.requests[0]!.system;
    expect(sys.length).toBeGreaterThanOrEqual(1);
    expect(sys[0]!.cache_control).toEqual({ type: "ephemeral" });
    // few_shot has the exemplar block too:
    expect(sys[1]?.cache_control).toEqual({ type: "ephemeral" });
  });
});
