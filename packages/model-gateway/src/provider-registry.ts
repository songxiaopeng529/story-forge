import { AnthropicProvider } from "./anthropic";
import type { ChatOptions, ModelProvider } from "./model-provider";
import { OpenAICompatibleProvider } from "./openai-compatible";

export type ProviderId = "deepseek" | "openai" | "anthropic" | "openrouter" | "volcano";
export type ProviderProtocol = "openai-compatible" | "anthropic";

export type ProviderPreset = {
  id: ProviderId;
  displayName: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  recommendedModels: string[];
  supportsImageInput: boolean;
  headers?: Record<string, string>;
  default?: boolean;
};

export type ProviderConnectionConfig = {
  providerId: ProviderId;
  baseUrl: string;
  model: string;
};

type FetchFunction = (input: string, init: RequestInit) => Promise<Response>;

export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
  deepseek: {
    id: "deepseek",
    displayName: "DeepSeek",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    recommendedModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
    supportsImageInput: false,
    default: true,
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    protocol: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    recommendedModels: ["gpt-5.4", "gpt-5.4-mini"],
    supportsImageInput: true,
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic Claude",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    recommendedModels: ["claude-opus-4-6", "claude-sonnet-4-6"],
    supportsImageInput: true,
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    protocol: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    recommendedModels: ["openrouter/auto"],
    supportsImageInput: true,
    headers: {
      "HTTP-Referer": "https://storyforge.local",
      "X-Title": "StoryForge",
    },
  },
  volcano: {
    id: "volcano",
    displayName: "Volcano Engine",
    protocol: "openai-compatible",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    recommendedModels: [],
    supportsImageInput: true,
  },
};

export class ProviderRegistry {
  private readonly fetch: FetchFunction;

  constructor(options: { fetch?: FetchFunction } = {}) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  createProvider(config: ProviderConnectionConfig, apiKey: string): ModelProvider {
    const preset = PROVIDER_PRESETS[config.providerId];
    if (preset.protocol === "anthropic") {
      return new AnthropicProvider({
        apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        fetch: this.fetch,
      });
    }

    return new OpenAICompatibleProvider({
      apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      fetch: this.fetch,
      ...(config.providerId === "deepseek"
        ? {
            capabilities: { contextWindowTokens: 1_000_000 },
            extraBody: {
              thinking: { type: "enabled" },
              reasoning_effort: "max",
            },
          }
        : {}),
      ...(preset.headers ? { headers: preset.headers } : {}),
    });
  }

  async discoverModels(
    config: ProviderConnectionConfig,
    apiKey: string,
    options: ChatOptions = {},
  ): Promise<string[]> {
    const preset = PROVIDER_PRESETS[config.providerId];
    if (config.providerId === "volcano") {
      await this.createProvider(config, apiKey).chat(
        { messages: [{ role: "user", content: "Reply with OK." }] },
        options,
      );
      return [config.model];
    }

    const url = preset.protocol === "anthropic"
      ? `${normalizeBaseUrl(config.baseUrl)}/v1/models`
      : `${normalizeBaseUrl(config.baseUrl)}/models`;
    const headers = preset.protocol === "anthropic"
      ? {
          "anthropic-version": "2023-06-01",
          "x-api-key": apiKey,
        }
      : {
          authorization: `Bearer ${apiKey}`,
          ...preset.headers,
        };
    const response = await this.fetch(url, {
      headers,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) {
      throw new Error(`Provider model discovery failed: ${response.status} ${response.statusText}`.trim());
    }
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    return (payload.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .sort();
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}
