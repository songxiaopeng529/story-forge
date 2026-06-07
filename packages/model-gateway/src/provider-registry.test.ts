import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "./anthropic";
import { OpenAICompatibleProvider } from "./openai-compatible";
import {
  PROVIDER_PRESETS,
  ProviderRegistry,
  type ProviderConnectionConfig,
} from "./provider-registry";

describe("ProviderRegistry", () => {
  it("defines the five supported provider presets with DeepSeek as the default", () => {
    expect(Object.keys(PROVIDER_PRESETS)).toEqual([
      "deepseek",
      "openai",
      "anthropic",
      "openrouter",
      "volcano",
    ]);
    expect(PROVIDER_PRESETS.deepseek).toMatchObject({
      default: true,
      baseUrl: "https://api.deepseek.com",
      recommendedModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
    });
  });

  it("creates OpenAI-compatible and Anthropic providers from public config plus a secret", () => {
    const registry = new ProviderRegistry();
    const deepseek = registry.createProvider(config("deepseek"), "deepseek-secret");
    const anthropic = registry.createProvider(config("anthropic"), "anthropic-secret");

    expect(deepseek).toBeInstanceOf(OpenAICompatibleProvider);
    expect(anthropic).toBeInstanceOf(AnthropicProvider);
    expect(deepseek.capabilities.contextWindowTokens).toBe(1_000_000);
  });

  it("discovers OpenAI-compatible models without exposing the secret", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "model-b" }, { id: "model-a" }] })),
    );
    const registry = new ProviderRegistry({ fetch });

    await expect(registry.discoverModels(config("deepseek"), "deepseek-secret")).resolves.toEqual([
      "model-a",
      "model-b",
    ]);
    expect(fetch).toHaveBeenCalledWith("https://api.deepseek.com/models", {
      headers: { authorization: "Bearer deepseek-secret" },
    });
  });
});

function config(providerId: ProviderConnectionConfig["providerId"]): ProviderConnectionConfig {
  const preset = PROVIDER_PRESETS[providerId];
  return {
    providerId,
    baseUrl: preset.baseUrl,
    model: preset.recommendedModels[0] ?? "custom-model",
  };
}
