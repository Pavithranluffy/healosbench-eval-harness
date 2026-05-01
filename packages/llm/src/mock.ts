import type { Provider, ProviderRequest, ProviderResponse } from "./provider";

export interface MockScript {
  /** Sequential responses; consumed in order on each send(). */
  responses: Array<Partial<ProviderResponse> | Error | { __throw: Error }>;
}

/**
 * Deterministic provider for tests. Each call to send() pops the next entry
 * from the script. Errors thrown lets us simulate 429 / network failures.
 */
export class MockProvider implements Provider {
  private idx = 0;
  public requests: ProviderRequest[] = [];

  constructor(private script: MockScript) {}

  async send(req: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(req);
    const next = this.script.responses[this.idx++];
    if (!next) throw new Error("MockProvider script exhausted");
    if (next instanceof Error) throw next;
    if (typeof next === "object" && next && "__throw" in next) throw next.__throw;
    const partial = next as Partial<ProviderResponse>;
    return {
      tool_input: partial.tool_input ?? null,
      text: partial.text ?? "",
      stop_reason: partial.stop_reason ?? "tool_use",
      usage: partial.usage ?? {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      raw: partial.raw ?? {},
    };
  }
}
