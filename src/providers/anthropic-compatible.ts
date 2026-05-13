import Anthropic from "@anthropic-ai/sdk";
import type { LLMClient, LLMRequest, LLMResponse } from "./base.js";

export interface AnthropicCompatibleClientOptions {
  model: string;
  baseURL: string;
  apiKey: string;
  fixedTemperature?: number;
}

export class AnthropicCompatibleClient implements LLMClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly fixedTemperature?: number;

  constructor(opts: AnthropicCompatibleClientOptions) {
    this.model = opts.model;
    this.fixedTemperature = opts.fixedTemperature;
    // Disable the SDK's built-in retry — `analyzer/runner.ts` wraps each call
    // with its own retry + dynamic concurrency throttling layer.
    this.client = new Anthropic({ baseURL: opts.baseURL, apiKey: opts.apiKey, maxRetries: 0 });
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const res = await this.client.messages.create({
      model: this.model,
      system: req.systemPrompt,
      messages: [{ role: "user", content: req.userPrompt }],
      max_tokens: req.maxTokens ?? 4096,
      temperature: this.fixedTemperature ?? req.temperature ?? 0.1,
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return {
      text,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  }
}
