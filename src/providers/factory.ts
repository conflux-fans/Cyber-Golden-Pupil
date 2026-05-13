import type { ProviderConfig } from "../config/index.js";
import type { LLMClient } from "./base.js";
import { OpenAICompatibleClient } from "./openai-compatible.js";
import { AnthropicCompatibleClient } from "./anthropic-compatible.js";

export function createClient(cfg: ProviderConfig): LLMClient {
  if (cfg.protocol === "openai") {
    return new OpenAICompatibleClient({
      model: cfg.model,
      baseURL: cfg.baseUrl,
      apiKey: cfg.apiKey,
      fixedTemperature: cfg.fixedTemperature,
      supportsJsonMode: cfg.supportsJsonMode,
    });
  }
  return new AnthropicCompatibleClient({
    model: cfg.model,
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey,
    fixedTemperature: cfg.fixedTemperature,
  });
}
