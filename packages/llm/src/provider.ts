/**
 * Provider abstraction: lets us swap real Anthropic for a deterministic mock
 * in tests. Keep the surface narrow on purpose — we only need tool-use messages.
 */

export interface CacheControlled {
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: object;
}

export interface ProviderRequest {
  model: string;
  system: CacheControlled[];
  messages: Array<{ role: "user" | "assistant"; content: string | unknown[] }>;
  tools: ToolDef[];
  tool_choice?: { type: "tool"; name: string };
  max_tokens?: number;
}

export interface ProviderUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ProviderResponse {
  /** The tool input as raw JSON value, if the model called the expected tool. */
  tool_input: unknown | null;
  /** Free-form text the model emitted before / instead of the tool call. */
  text: string;
  /** Stop reason the SDK reported ("tool_use" on success, "max_tokens" / "end_turn" otherwise). */
  stop_reason: string | null;
  usage: ProviderUsage;
  /** The raw SDK response, for debug / logging in the dashboard. */
  raw: unknown;
}

export interface Provider {
  send(req: ProviderRequest): Promise<ProviderResponse>;
}
