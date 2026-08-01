import type { PiModelService } from "@story-forge/agent";
import type { ProviderId, ProviderView } from "@story-forge/shared";

export type SaveProviderInput = {
  providerId: ProviderId;
  baseUrl?: string;
  model: string;
  apiKey?: string;
};

export class ProviderService {
  private readonly piModels: PiModelService;

  constructor(options: { piModels: PiModelService }) {
    this.piModels = options.piModels;
  }

  list(): Promise<ProviderView[]> {
    return this.piModels.list();
  }

  save(input: SaveProviderInput): Promise<ProviderView> {
    return this.piModels.save({
      providerId: input.providerId,
      model: input.model,
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    });
  }

  setDefault(providerId: ProviderId): Promise<void> {
    return this.piModels.setDefault(providerId);
  }

  clearSecret(providerId: ProviderId): Promise<void> {
    return this.piModels.clearSecret(providerId);
  }

  test(providerId: ProviderId): Promise<{ models: string[] }> {
    return this.piModels.test(providerId);
  }

  discoverModels(providerId: ProviderId): Promise<string[]> {
    return this.piModels.discoverModels(providerId);
  }
}
