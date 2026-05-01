import { AnthropicProvider, MockProvider, extract, getStrategy, type ExtractResult } from "@test-evals/llm";
import type { Provider } from "@test-evals/llm";
import type { Strategy } from "@test-evals/shared";

export interface ExtractInput {
  strategy: Strategy;
  model: string;
  transcript: string;
  apiKey?: string | null;
  /** Inject gold data for high-fidelity mock demo when no API key is set. */
  gold?: any;
  /** Inject a provider instead of constructing AnthropicProvider — used by tests and the mock CLI mode. */
  provider?: Provider;
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Single entry point used by the runner / CLI / tests.
 *
 * Falls back to a MockProvider when no API key is available so the harness
 * is at least demoable in CI without burning real $.
 */
export async function runExtraction(input: ExtractInput): Promise<ExtractResult & { prompt_hash: string }> {
  const strategy = getStrategy(input.strategy);
  const provider: Provider =
    input.provider ??
    (input.apiKey
      ? new AnthropicProvider({ apiKey: input.apiKey })
      : new MockProvider({
          responses: [
            {
              tool_input: input.gold ?? {
                chief_complaint: "[no api key configured — mock prediction]",
                vitals: { bp: null, hr: null, temp_f: null, spo2: null },
                medications: [],
                diagnoses: [],
                plan: [],
                follow_up: { interval_days: null, reason: null },
              },
            },
          ],
        }));

  const result = await extract({
    provider,
    strategy,
    model: input.model,
    transcript: input.transcript,
    sleepFn: input.sleepFn,
  });
  return { ...result, prompt_hash: strategy.hash() };
}
