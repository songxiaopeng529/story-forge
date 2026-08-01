import {
  ModelRuntime,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ProviderId, ProviderView } from "@story-forge/shared";
import type { CreateStoryForgeAgentSessionInput } from "./create-storyforge-session";

export type LegacyCredentialCrypto = {
  isEncryptionAvailable(): boolean;
  decryptString(value: Buffer): string;
};

export type ResolvedPiModel = NonNullable<CreateStoryForgeAgentSessionInput["model"]>;

const legacyProviderRecordSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().optional(),
  isDefault: z.boolean().optional(),
});

const legacyProvidersFileSchema = z.object({
  schemaVersion: z.literal(1),
  providers: z.array(legacyProviderRecordSchema),
});

const legacySecretsFileSchema = z.object({
  schemaVersion: z.literal(1),
  secrets: z.record(z.string(), z.string()),
});

export class PiModelService {
  private readonly rootDir: string;
  private readonly agentDir: string;
  private readonly settingsManager: SettingsManager;
  private modelRuntimePromise: Promise<ModelRuntime> | undefined;
  private readonly lastTestStatus = new Map<ProviderId, ProviderView["lastTestStatus"]>();

  constructor(options: { rootDir: string }) {
    this.rootDir = options.rootDir;
    this.agentDir = join(options.rootDir, "pi-agent");
    this.settingsManager = SettingsManager.create(options.rootDir, this.agentDir);
  }

  getAgentDir(): string {
    return this.agentDir;
  }

  createSettingsManager(cwd: string): SettingsManager {
    return SettingsManager.create(cwd, this.agentDir);
  }

  async getModelRuntime(): Promise<ModelRuntime> {
    this.modelRuntimePromise ??= ModelRuntime.create({
      authPath: join(this.agentDir, "auth.json"),
      modelsPath: join(this.agentDir, "models.json"),
      allowModelNetwork: false,
    });
    return this.modelRuntimePromise;
  }

  async list(): Promise<ProviderView[]> {
    const runtime = await this.getModelRuntime();
    const defaultProvider = this.settingsManager.getDefaultProvider();
    const defaultModel = this.settingsManager.getDefaultModel();
    const credentials = await runtime.listCredentials();
    const credentialProviders = new Set(credentials.map((credential) => credential.providerId));

    return runtime.getProviders()
      .map((provider) => {
        const models = runtime.getModels(provider.id);
        const configuredModel = provider.id === defaultProvider ? defaultModel : undefined;
        const selectedModel = configuredModel && models.some((model) => model.id === configuredModel)
          ? configuredModel
          : models[0]?.id ?? "";
        const selectedModelRecord = selectedModel
          ? runtime.getModel(provider.id, selectedModel)
          : undefined;
        const authStatus = runtime.getProviderAuthStatus(provider.id);
        return {
          providerId: provider.id,
          displayName: provider.name || provider.id,
          baseUrl: provider.baseUrl ?? selectedModelRecord?.baseUrl ?? "",
          model: selectedModel,
          recommendedModels: models.map((model) => model.id),
          supportsImageInput: Boolean(selectedModelRecord?.input.includes("image")),
          isDefault: provider.id === defaultProvider,
          hasSecret: credentialProviders.has(provider.id) || authStatus.configured,
          lastTestStatus: this.lastTestStatus.get(provider.id) ?? "untested",
        } satisfies ProviderView;
      })
      .sort((left, right) => {
        if (left.isDefault !== right.isDefault) {
          return left.isDefault ? -1 : 1;
        }
        if (left.hasSecret !== right.hasSecret) {
          return left.hasSecret ? -1 : 1;
        }
        return left.displayName.localeCompare(right.displayName);
      });
  }

  async save(input: {
    providerId: ProviderId;
    model: string;
    apiKey?: string;
  }): Promise<ProviderView> {
    const runtime = await this.getModelRuntime();
    const apiKey = input.apiKey?.trim();
    if (apiKey) {
      await runtime.setRuntimeApiKey(input.providerId, apiKey, { allowNetwork: false });
    }
    if (input.model.trim()) {
      this.settingsManager.setDefaultModelAndProvider(input.providerId, input.model.trim());
      await this.settingsManager.flush();
    }
    const provider = (await this.list()).find((candidate) => candidate.providerId === input.providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${input.providerId}`);
    }
    return provider;
  }

  async setDefault(providerId: ProviderId): Promise<void> {
    const runtime = await this.getModelRuntime();
    const model = runtime.getModels(providerId)[0];
    if (!model) {
      throw new Error(`No models found for provider: ${providerId}`);
    }
    this.settingsManager.setDefaultModelAndProvider(providerId, model.id);
    await this.settingsManager.flush();
  }

  async clearSecret(providerId: ProviderId): Promise<void> {
    const runtime = await this.getModelRuntime();
    await runtime.removeRuntimeApiKey(providerId);
    this.lastTestStatus.set(providerId, "untested");
  }

  async test(providerId: ProviderId): Promise<{ models: string[] }> {
    try {
      const runtime = await this.getModelRuntime();
      const auth = await runtime.checkAuth(providerId);
      if (!auth && !runtime.hasConfiguredAuth(providerId)) {
        throw new Error(`Provider is not configured: ${providerId}`);
      }
      const models = await this.discoverModels(providerId);
      this.lastTestStatus.set(providerId, "success");
      return { models };
    } catch (error) {
      this.lastTestStatus.set(providerId, "failed");
      throw error;
    }
  }

  async discoverModels(providerId: ProviderId): Promise<string[]> {
    const runtime = await this.getModelRuntime();
    const available = await runtime.getAvailable(providerId);
    const models = available.length > 0 ? available : runtime.getModels(providerId);
    return models.map((model) => model.id);
  }

  async resolveModel(
    providerId: ProviderId | undefined,
    modelId: string | undefined,
  ): Promise<ResolvedPiModel | undefined> {
    const runtime = await this.getModelRuntime();
    const provider = providerId ?? this.settingsManager.getDefaultProvider();
    const model = modelId ?? this.settingsManager.getDefaultModel();
    if (provider && model) {
      const resolved = runtime.getModel(provider, model);
      if (resolved) {
        return resolved;
      }
    }
    return undefined;
  }

  async migrateLegacyCredentials(options: { crypto: LegacyCredentialCrypto }): Promise<void> {
    if (!options.crypto.isEncryptionAvailable()) {
      return;
    }
    const [providersFile, secretsFile] = await Promise.all([
      readOptionalJson(join(this.rootDir, "providers.json"), legacyProvidersFileSchema),
      readOptionalJson(join(this.rootDir, "secrets.json"), legacySecretsFileSchema),
    ]);
    if (!providersFile || !secretsFile) {
      return;
    }

    const runtime = await this.getModelRuntime();
    for (const provider of providersFile.providers) {
      const encrypted = secretsFile.secrets[provider.providerId];
      if (!encrypted || runtime.hasConfiguredAuth(provider.providerId)) {
        continue;
      }
      const apiKey = options.crypto.decryptString(Buffer.from(encrypted, "base64"));
      if (apiKey.trim()) {
        await runtime.setRuntimeApiKey(provider.providerId, apiKey, { allowNetwork: false });
      }
      if (provider.isDefault && provider.model) {
        this.settingsManager.setDefaultModelAndProvider(provider.providerId, provider.model);
      }
    }
    await this.settingsManager.flush();
    await mkdir(join(this.rootDir, "migrations"), { recursive: true });
    await writeFile(
      join(this.rootDir, "migrations", "legacy-provider-credentials-to-pi.txt"),
      new Date().toISOString(),
      "utf8",
    );
  }
}

async function readOptionalJson<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
): Promise<z.infer<Schema> | undefined> {
  try {
    return schema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
}
