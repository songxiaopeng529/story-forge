import {
  ModelRuntime,
  readStoredCredential,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ProviderId, ProviderView } from "@story-forge/shared";
import { writeJsonAtomic } from "./atomic-json";
import type { CreateStoryForgeAgentSessionInput } from "./create-storyforge-session";

export type LegacyCredentialCrypto = {
  isEncryptionAvailable(): boolean;
  decryptString(value: Buffer): string;
};

export type ResolvedPiModel = NonNullable<CreateStoryForgeAgentSessionInput["model"]>;
type ProviderRegistration = Parameters<ModelRuntime["registerProvider"]>[1];
type ProviderModelRegistration = NonNullable<ProviderRegistration["models"]>[number];
type RuntimeModel = ReturnType<ModelRuntime["getModels"]>[number];

const VOLCANO_PROVIDER_ID = "volcano";
const VOLCANO_PROVIDER_NAME = "Volcano Engine (火山引擎)";
const VOLCANO_DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const VOLCANO_DEFAULT_MODEL = "doubao-seed-2-0-lite-260215";
const VOLCANO_RECOMMENDED_MODELS = [
  VOLCANO_DEFAULT_MODEL,
  "doubao-seed-1-6-250615",
  "ep-your-endpoint-id",
];

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

const providerOverrideSchema = z.object({
  baseUrl: z.string().optional(),
  model: z.string().optional(),
});

const providerOverridesFileSchema = z.object({
  schemaVersion: z.literal(1),
  providers: z.record(z.string(), providerOverrideSchema),
});

const authStorageFileSchema = z.record(z.string(), z.unknown());

type ProviderOverridesFile = z.infer<typeof providerOverridesFileSchema>;
type ProviderOverride = z.infer<typeof providerOverrideSchema>;

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
    this.modelRuntimePromise ??= this.createModelRuntime();
    return this.modelRuntimePromise;
  }

  private async createModelRuntime(): Promise<ModelRuntime> {
    const runtime = await ModelRuntime.create({
      authPath: this.getAuthPath(),
      modelsPath: join(this.agentDir, "models.json"),
      allowModelNetwork: false,
    });
    await this.registerStoryForgeProviders(runtime);
    return runtime;
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
        const rankDelta = providerListRank(left.providerId) - providerListRank(right.providerId);
        if (rankDelta !== 0) {
          return rankDelta;
        }
        return left.displayName.localeCompare(right.displayName);
      });
  }

  async save(input: {
    providerId: ProviderId;
    baseUrl?: string;
    model: string;
    apiKey?: string;
  }): Promise<ProviderView> {
    const runtime = await this.getModelRuntime();
    await this.updateManagedProvider(runtime, input);
    const apiKey = input.apiKey?.trim();
    if (apiKey) {
      await this.persistApiKey(input.providerId, apiKey);
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
    await this.deletePersistedApiKey(providerId);
    this.modelRuntimePromise = undefined;
    this.lastTestStatus.set(providerId, "untested");
  }

  async revealSecret(providerId: ProviderId): Promise<string | undefined> {
    const credential = readStoredCredential(providerId, this.getAuthPath());
    if (credential?.type === "api_key" && credential.key) {
      return credential.key;
    }
    const runtime = await this.getModelRuntime();
    if (!runtime.isUsingOAuth(providerId)) {
      const auth = await runtime.getAuth(providerId);
      if (auth?.auth.apiKey) {
        return auth.auth.apiKey;
      }
    }
    return undefined;
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
        await this.persistApiKey(provider.providerId, apiKey);
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

  private getAuthPath(): string {
    return join(this.agentDir, "auth.json");
  }

  private getProviderOverridesPath(): string {
    return join(this.agentDir, "storyforge-provider-overrides.json");
  }

  private async registerStoryForgeProviders(runtime: ModelRuntime): Promise<void> {
    const overrides = await this.readProviderOverrides();
    runtime.registerProvider(
      VOLCANO_PROVIDER_ID,
      createVolcanoProviderConfig(overrides.providers[VOLCANO_PROVIDER_ID]),
    );
    for (const [providerId, override] of Object.entries(overrides.providers)) {
      if (providerId === VOLCANO_PROVIDER_ID) {
        continue;
      }
      registerProviderOverride(runtime, providerId, override);
    }
  }

  private async updateManagedProvider(
    runtime: ModelRuntime,
    input: { providerId: ProviderId; baseUrl?: string; model: string },
  ): Promise<void> {
    const overrides = await this.readProviderOverrides();
    const previous = overrides.providers[input.providerId] ?? {};
    const next: ProviderOverride = { ...previous };
    const trimmedModel = input.model.trim();
    if (trimmedModel) {
      next.model = trimmedModel;
    }
    if (input.baseUrl !== undefined) {
      const trimmedBaseUrl = input.baseUrl.trim();
      if (trimmedBaseUrl) {
        next.baseUrl = trimmedBaseUrl;
      } else {
        delete next.baseUrl;
      }
    }
    const providers = {
      ...overrides.providers,
    };
    if (next.model || next.baseUrl) {
      providers[input.providerId] = next;
    } else {
      delete providers[input.providerId];
    }
    const updated: ProviderOverridesFile = {
      schemaVersion: 1,
      providers,
    };
    await writeJsonAtomic(this.getProviderOverridesPath(), updated, { mode: 0o600 });
    if (input.providerId === VOLCANO_PROVIDER_ID) {
      runtime.registerProvider(VOLCANO_PROVIDER_ID, createVolcanoProviderConfig(next));
      return;
    }
    registerProviderOverride(runtime, input.providerId, next);
  }

  private async readProviderOverrides(): Promise<ProviderOverridesFile> {
    return await readOptionalJson(
      this.getProviderOverridesPath(),
      providerOverridesFileSchema,
    ) ?? {
      schemaVersion: 1,
      providers: {},
    };
  }

  private async persistApiKey(
    providerId: ProviderId,
    apiKey: string,
  ): Promise<void> {
    const authPath = this.getAuthPath();
    const current = await readOptionalJson(authPath, authStorageFileSchema) ?? {};
    await writeJsonAtomic(authPath, {
      ...current,
      [providerId]: {
        type: "api_key",
        key: apiKey,
      },
    }, { mode: 0o600 });
    this.modelRuntimePromise = undefined;
  }

  private async deletePersistedApiKey(providerId: ProviderId): Promise<void> {
    const authPath = this.getAuthPath();
    const current = await readOptionalJson(authPath, authStorageFileSchema);
    if (!current || !(providerId in current)) {
      return;
    }
    const next = { ...current };
    delete next[providerId];
    await writeJsonAtomic(authPath, next, { mode: 0o600 });
    this.modelRuntimePromise = undefined;
  }
}

function createVolcanoProviderConfig(override?: ProviderOverride): ProviderRegistration {
  const baseUrl = override?.baseUrl?.trim() || VOLCANO_DEFAULT_BASE_URL;
  const modelIds = unique([
    override?.model?.trim(),
    ...VOLCANO_RECOMMENDED_MODELS,
  ].filter((modelId): modelId is string => Boolean(modelId)));

  return {
    name: VOLCANO_PROVIDER_NAME,
    baseUrl,
    api: "openai-completions",
    apiKey: "$ARK_API_KEY",
    models: modelIds.map((modelId) => ({
      id: modelId,
      name: modelId,
      reasoning: false,
      input: ["text" as const],
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: 128000,
      maxTokens: 16384,
    })),
  };
}

function registerProviderOverride(
  runtime: ModelRuntime,
  providerId: ProviderId,
  override: ProviderOverride,
): void {
  const baseUrl = override.baseUrl?.trim();
  const modelId = override.model?.trim();
  if (!baseUrl && !modelId) {
    return;
  }

  const provider = runtime.getProvider(providerId);
  if (!provider) {
    return;
  }

  const config: ProviderRegistration = {
    ...(provider.name ? { name: provider.name } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
  if (modelId) {
    config.models = createProviderModelRegistrations(runtime.getModels(providerId), {
      baseUrl,
      modelId,
    });
  }
  runtime.registerProvider(providerId, config);
}

function createProviderModelRegistrations(
  existingModels: readonly RuntimeModel[],
  custom: { baseUrl: string | undefined; modelId: string },
): ProviderModelRegistration[] {
  const modelDefinitions = existingModels.map((model) => toProviderModelRegistration(model));
  if (!modelDefinitions.some((definition) => definition.id === custom.modelId)) {
    modelDefinitions.unshift(createCustomProviderModelRegistration({
      baseUrl: custom.baseUrl,
      modelId: custom.modelId,
      template: existingModels[0],
    }));
  }
  return uniqueById(modelDefinitions);
}

function toProviderModelRegistration(model: RuntimeModel): ProviderModelRegistration {
  return {
    id: model.id,
    name: model.name || model.id,
    api: model.api,
    reasoning: model.reasoning,
    input: [...model.input],
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...(model.headers ? { headers: model.headers } : {}),
    ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
    ...(model.compat ? { compat: model.compat } : {}),
  };
}

function createCustomProviderModelRegistration(input: {
  baseUrl: string | undefined;
  modelId: string;
  template: RuntimeModel | undefined;
}): ProviderModelRegistration {
  return {
    id: input.modelId,
    name: input.modelId,
    api: input.template?.api ?? "openai-completions",
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    reasoning: input.template?.reasoning ?? false,
    input: [...(input.template?.input ?? ["text" as const])],
    cost: input.template?.cost ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: input.template?.contextWindow ?? 128000,
    maxTokens: input.template?.maxTokens ?? 16384,
    ...(input.template?.headers ? { headers: input.template.headers } : {}),
    ...(input.template?.thinkingLevelMap ? { thinkingLevelMap: input.template.thinkingLevelMap } : {}),
    ...(input.template?.compat ? { compat: input.template.compat } : {}),
  };
}

function uniqueById(models: ProviderModelRegistration[]): ProviderModelRegistration[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) {
      return false;
    }
    seen.add(model.id);
    return true;
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function providerListRank(providerId: ProviderId): number {
  return providerId === VOLCANO_PROVIDER_ID ? 0 : 1;
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
