import Anthropic from "@anthropic-ai/sdk";
import type { Provider, ProviderRequest, ProviderResponse } from "./provider";
import { EXTRACTION_TOOL_NAME } from "./tool-schema";

export class AnthropicProvider implements Provider {
  private client: Anthropic;

  constructor(opts: { apiKey: string; baseURL?: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  }

  async send(req: ProviderRequest): Promise<ProviderResponse> {
    const systemBlocks = req.system.map((s) => ({
      type: "text" as const,
      text: s.text,
      ...(s.cache_control ? { cache_control: s.cache_control } : {}),
    }));

    const response = await this.client.messages.create({
      model: req.model,
      max_tokens: req.max_tokens ?? 2048,
      system: systemBlocks,
      messages: req.messages as Anthropic.MessageParam[],
      tools: req.tools as Anthropic.Tool[],
      tool_choice: req.tool_choice ?? { type: "tool", name: EXTRACTION_TOOL_NAME },
    });

    let tool_input: unknown | null = null;
    let text = "";
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === EXTRACTION_TOOL_NAME) {
        tool_input = block.input;
      } else if (block.type === "text") {
        text += block.text;
      }
    }

    const usage = response.usage;
    return {
      tool_input,
      text,
      stop_reason: response.stop_reason,
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      },
      raw: response,
    };
  }
}
