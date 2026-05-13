export type ProviderProtocol = "openai" | "anthropic";

export interface ProviderConfig {
  providerName: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** If set, overrides any per-request temperature. Used for providers like
   *  Kimi that require a specific value. */
  fixedTemperature?: number;
  /** Whether the vendor accepts OpenAI's `response_format: { type: "json_object" }`.
   *  Many Chinese vendors reject it with `400 Param Incorrect`. */
  supportsJsonMode: boolean;
}

interface ProviderDef {
  protocol: ProviderProtocol;
  envApiKey: string;
  envBaseUrl: string;
  envModel: string;
  defaultBaseUrl: string;
  defaultModel: string;
  fixedTemperature?: number;
  supportsJsonMode?: boolean;
}

const PROVIDERS: Record<string, ProviderDef> = {
  kimi: {
    protocol: "openai",
    envApiKey: "KIMI_API_KEY",
    envBaseUrl: "KIMI_BASE_URL",
    envModel: "KIMI_MODEL",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.6",
    // Kimi API only accepts temperature=1.
    fixedTemperature: 1,
  },
  glm: {
    protocol: "openai",
    envApiKey: "GLM_API_KEY",
    envBaseUrl: "GLM_BASE_URL",
    envModel: "GLM_MODEL",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4.5",
  },
  openrouter: {
    protocol: "openai",
    envApiKey: "OPENROUTER_API_KEY",
    envBaseUrl: "OPENROUTER_BASE_URL",
    envModel: "OPENROUTER_MODEL",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4",
  },
  deepseek: {
    protocol: "openai",
    envApiKey: "DEEPSEEK_API_KEY",
    envBaseUrl: "DEEPSEEK_BASE_URL",
    envModel: "DEEPSEEK_MODEL",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
  },
  mimo: {
    protocol: "openai",
    envApiKey: "MIMO_API_KEY",
    envBaseUrl: "MIMO_BASE_URL",
    envModel: "MIMO_MODEL",
    defaultBaseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    // No safe default — Mimo requires a concrete model id (set MIMO_MODEL in .env).
    defaultModel: "",
  },
  "mimo-anthropic": {
    protocol: "anthropic",
    envApiKey: "MIMO_API_KEY",
    envBaseUrl: "MIMO_ANTHROPIC_BASE_URL",
    envModel: "MIMO_MODEL",
    defaultBaseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic",
    defaultModel: "mimo",
  },
};

export function loadConfig(providerName: string): ProviderConfig {
  const def = PROVIDERS[providerName];
  if (!def) {
    throw new Error(
      `Unknown provider: ${providerName}. Known: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  const apiKey = process.env[def.envApiKey];
  if (!apiKey) {
    throw new Error(`Missing API key: set ${def.envApiKey} in env or .env`);
  }
  const model = process.env[def.envModel] ?? def.defaultModel;
  if (!model) {
    throw new Error(
      `Missing model id for provider "${providerName}": set ${def.envModel} in env or .env`,
    );
  }
  return {
    providerName,
    protocol: def.protocol,
    baseUrl: process.env[def.envBaseUrl] ?? def.defaultBaseUrl,
    apiKey,
    model,
    fixedTemperature: def.fixedTemperature,
    supportsJsonMode: def.supportsJsonMode ?? true,
  };
}

export function listProviders(): string[] {
  return Object.keys(PROVIDERS);
}
