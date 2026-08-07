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
      ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
      model: input.model,
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    });
  }

  setDefault(input: { providerId: ProviderId; model: string }): Promise<void> {
    return this.piModels.setDefault(input);
  }

  clearSecret(providerId: ProviderId): Promise<void> {
    return this.piModels.clearSecret(providerId);
  }

  revealSecret(providerId: ProviderId): Promise<string | undefined> {
    const piModels = this.piModels as PiModelService & {
      revealSecret?: (providerId: ProviderId) => Promise<string | undefined>;
    };
    if (typeof piModels.revealSecret === "function") {
      return piModels.revealSecret(providerId);
    }
    return revealSecretFromRuntime(piModels, providerId);
  }

  test(providerId: ProviderId): Promise<{ models: string[] }> {
    return this.piModels.test(providerId);
  }

  discoverModels(providerId: ProviderId): Promise<string[]> {
    return this.piModels.discoverModels(providerId);
  }
}

async function revealSecretFromRuntime(
  piModels: PiModelService,
  providerId: ProviderId,
): Promise<string | undefined> {
  const runtime = await piModels.getModelRuntime();
  if (runtime.isUsingOAuth(providerId)) {
    return undefined;
  }
  const auth = await runtime.getAuth(providerId);
  return auth?.auth.apiKey;
}
