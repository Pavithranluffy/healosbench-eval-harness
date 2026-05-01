/**
 * Anthropic per-million-token pricing (USD), as of 2026-01.
 * Source: anthropic.com/pricing — kept here so the eval can show $ alongside scores.
 */
export interface PriceCard {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

export const PRICING: Record<string, PriceCard> = {
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0, cache_write: 1.25, cache_read: 0.1 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
  "claude-opus-4-7": { input: 15.0, output: 75.0, cache_write: 18.75, cache_read: 1.5 },
};

export function priceFor(model: string): PriceCard {
  return PRICING[model] ?? PRICING["claude-haiku-4-5-20251001"]!;
}

export function computeCostUsd(model: string, usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}): number {
  const p = priceFor(model);
  const baseInput = Math.max(0, usage.input_tokens - (usage.cache_read_input_tokens ?? 0) - (usage.cache_creation_input_tokens ?? 0));
  return (
    (baseInput * p.input) / 1_000_000 +
    (usage.output_tokens * p.output) / 1_000_000 +
    ((usage.cache_creation_input_tokens ?? 0) * p.cache_write) / 1_000_000 +
    ((usage.cache_read_input_tokens ?? 0) * p.cache_read) / 1_000_000
  );
}
