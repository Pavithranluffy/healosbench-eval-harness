import {
  validateExtraction,
  type AttemptLog,
  type ClinicalExtraction,
} from "@test-evals/shared";
import type { Provider, ProviderRequest } from "./provider";
import { extractionTool, EXTRACTION_TOOL_NAME } from "./tool-schema";
import type { PromptStrategy } from "./strategies";
import { withBackoff } from "./rate-limit";

export interface ExtractOptions {
  provider: Provider;
  strategy: PromptStrategy;
  model: string;
  transcript: string;
  maxAttempts?: number;
  /** Test-only sleep override forwarded to withBackoff. */
  sleepFn?: (ms: number) => Promise<void>;
}

export interface ExtractResult {
  prediction: ClinicalExtraction | null;
  schema_invalid: boolean;
  attempts: AttemptLog[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read: number;
  total_cache_write: number;
  duration_ms: number;
}

/**
 * Run the extractor with retry-with-validation-feedback up to maxAttempts.
 *
 * Cache strategy:
 *   system block 1 — base instructions, cache_control: ephemeral
 *   system block 2 — few-shot exemplars (if any), cache_control: ephemeral
 *   user block    — transcript (uncached, since it's per-case)
 *
 * On schema validation failure, we append the model's prior tool call response
 * AND a human-readable error list to the message history, then ask it to
 * correct itself by calling the tool again.
 */
export async function extract(opts: ExtractOptions): Promise<ExtractResult> {
  const max = opts.maxAttempts ?? 3;
  const attempts: AttemptLog[] = [];
  const start = Date.now();

  const system: ProviderRequest["system"] = [
    { text: opts.strategy.system, cache_control: { type: "ephemeral" } },
  ];
  if (opts.strategy.exemplars) {
    system.push({ text: opts.strategy.exemplars, cache_control: { type: "ephemeral" } });
  }

  const messages: ProviderRequest["messages"] = [
    { role: "user", content: opts.strategy.buildUserMessage(opts.transcript) },
  ];

  let totalIn = 0,
    totalOut = 0,
    totalCacheRead = 0,
    totalCacheWrite = 0;
  let prediction: ClinicalExtraction | null = null;
  let schemaInvalid = true;

  for (let attempt = 1; attempt <= max; attempt++) {
    const req: ProviderRequest = {
      model: opts.model,
      system,
      messages,
      tools: [extractionTool],
      tool_choice: { type: "tool", name: EXTRACTION_TOOL_NAME },
      max_tokens: 2048,
    };

    const tStart = Date.now();
    const res = await withBackoff(() => opts.provider.send(req), { sleepFn: opts.sleepFn });
    const tDur = Date.now() - tStart;

    totalIn += res.usage.input_tokens;
    totalOut += res.usage.output_tokens;
    totalCacheRead += res.usage.cache_read_input_tokens;
    totalCacheWrite += res.usage.cache_creation_input_tokens;

    const validation = res.tool_input == null
      ? { valid: false, errors: ["Model did not call the record_extraction tool."] }
      : validateExtraction(res.tool_input);

    attempts.push({
      attempt,
      request: { system, messages, tool: EXTRACTION_TOOL_NAME },
      response: { tool_input: res.tool_input, text: res.text, stop_reason: res.stop_reason },
      tokens_in: res.usage.input_tokens,
      tokens_out: res.usage.output_tokens,
      cache_read: res.usage.cache_read_input_tokens,
      cache_write: res.usage.cache_creation_input_tokens,
      schema_valid: validation.valid,
      validation_errors: validation.errors,
      duration_ms: tDur,
    });

    if (validation.valid) {
      prediction = res.tool_input as ClinicalExtraction;
      schemaInvalid = false;
      break;
    }

    if (attempt >= max) break;

    // Build the retry feedback turn. We feed the prior assistant tool_use back
    // into the conversation as a tool_result with the validation errors, so
    // the model can self-correct in the next assistant turn.
    messages.push({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: `attempt_${attempt}`,
          name: EXTRACTION_TOOL_NAME,
          input: res.tool_input ?? {},
        },
      ],
    });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: `attempt_${attempt}`,
          is_error: true,
          content: `Your extraction failed JSON Schema validation. Fix every error and call record_extraction again with a fully valid object.\n\nVALIDATION ERRORS:\n${validation.errors.map((e) => `- ${e}`).join("\n")}`,
        },
      ],
    });
  }

  return {
    prediction,
    schema_invalid: schemaInvalid,
    attempts,
    total_input_tokens: totalIn,
    total_output_tokens: totalOut,
    total_cache_read: totalCacheRead,
    total_cache_write: totalCacheWrite,
    duration_ms: Date.now() - start,
  };
}
