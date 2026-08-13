import type { PiModelService, SessionRepository } from "@story-forge/agent";
import type { ProviderId, ProviderView } from "@story-forge/shared";

export type SaveProviderInput = {
  providerId: ProviderId;
  baseUrl?: string;
  model: string;
  apiKey?: string;
};

export class ProviderService {
  private readonly piModels: PiModelService;
  private readonly sessions: Pick<SessionRepository, "updateModelForAllSessions">;
  private setDefaultTail: Promise<void> = Promise.resolve();

  constructor(options: {
    piModels: PiModelService;
    sessions: Pick<SessionRepository, "updateModelForAllSessions">;
  }) {
    this.piModels = options.piModels;
    this.sessions = options.sessions;
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
    const selection = {
      providerId: input.providerId,
      model: input.model.trim(),
    };
    const operation = this.setDefaultTail.then(() => this.applyDefault(selection));
    this.setDefaultTail = operation.catch(() => undefined);
    return operation;
  }

  private async applyDefault(selection: {
    providerId: ProviderId;
    model: string;
  }): Promise<void> {
    await this.piModels.setDefault(selection);
    try {
      await this.sessions.updateModelForAllSessions(selection);
    } catch (error) {
      // The PI default remains the runtime source of truth. Existing session
      // metadata is a denormalized cache and is reconciled again on its next turn.
      console.warn("Failed to synchronize the default model to session metadata", error);
    }
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
