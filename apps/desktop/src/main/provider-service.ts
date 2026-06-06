import {
  ProviderRegistry,
  type ProviderId,
} from "@story-forge/model-gateway";
import type {
  ProviderConfigStore,
  ProviderView,
  SaveProviderInput,
} from "./provider-config-store";

export class ProviderService {
  private readonly store: ProviderConfigStore;
  private readonly registry: Pick<ProviderRegistry, "discoverModels">;

  constructor(options: {
    store: ProviderConfigStore;
    registry: Pick<ProviderRegistry, "discoverModels">;
  }) {
    this.store = options.store;
    this.registry = options.registry;
  }

  list(): Promise<ProviderView[]> {
    return this.store.list();
  }

  save(input: SaveProviderInput): Promise<ProviderView> {
    return this.store.save(input);
  }

  setDefault(providerId: ProviderId): Promise<void> {
    return this.store.setDefault(providerId);
  }

  clearSecret(providerId: ProviderId): Promise<void> {
    return this.store.clearSecret(providerId);
  }

  async test(providerId: ProviderId): Promise<{ models: string[] }> {
    try {
      const models = await this.discoverModels(providerId);
      await this.store.recordTest(providerId, "success");
      return { models };
    } catch (error) {
      await this.store.recordTest(providerId, "failed");
      throw error;
    }
  }

  async discoverModels(providerId: ProviderId): Promise<string[]> {
    const resolved = await this.store.resolve(providerId);
    try {
      return await this.registry.discoverModels(
        {
          providerId,
          baseUrl: resolved.baseUrl,
          model: resolved.model,
        },
        resolved.apiKey,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message.split(resolved.apiKey).join("[REDACTED]"), { cause: error });
    }
  }
}
