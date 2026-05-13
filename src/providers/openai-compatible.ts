import OpenAI from "openai";
import type { LLMClient, LLMRequest, LLMResponse } from "./base.js";

export interface OpenAICompatibleClientOptions {
  model: string;
  baseURL: string;
  apiKey: string;
  fixedTemperature?: number;
  supportsJsonMode?: boolean;
}

export class OpenAICompatibleClient implements LLMClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly fixedTemperature?: number;
  private readonly supportsJsonMode: boolean;

  constructor(opts: OpenAICompatibleClientOptions) {
    this.model = opts.model;
    this.fixedTemperature = opts.fixedTemperature;
    this.supportsJsonMode = opts.supportsJsonMode ?? true;
    // Disable the SDK's built-in retry — `analyzer/runner.ts` wraps each call
    // with its own retry + dynamic concurrency throttling layer.
    this.client = new OpenAI({ baseURL: opts.baseURL, apiKey: opts.apiKey, maxRetries: 0 });
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user", content: req.userPrompt },
      ],
      temperature: this.fixedTemperature ?? req.temperature ?? 0.1,
      max_tokens: req.maxTokens,
    };
    if (this.supportsJsonMode) {
      params.response_format = { type: "json_object" };
    }

    const res = await this.client.chat.completions.create(params);
    return {
      text: res.choices[0]?.message?.content ?? "",
      inputTokens: res.usage?.prompt_tokens,
      outputTokens: res.usage?.completion_tokens,
    };
  }
}
