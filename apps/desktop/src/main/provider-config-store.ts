import {
  PROVIDER_PRESETS,
  type ProviderConnectionConfig,
  type ProviderId,
} from "@story-forge/model-gateway";
import { join } from "node:path";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "./atomic-json";

export type CredentialCrypto = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

const providerRecordSchema = z.object({
  providerId: z.enum(["deepseek", "openai", "anthropic", "openrouter", "volcano"]),
  baseUrl: z.string().min(1),
  model: z.string(),
  isDefault: z.boolean(),
  lastTestStatus: z.enum(["untested", "success", "failed"]).default("untested"),
  lastTestedAt: z.string().optional(),
});

const providersFileSchema = z.object({
  schemaVersion: z.literal(1),
  providers: z.array(providerRecordSchema),
});

const secretsFileSchema = z.object({
  schemaVersion: z.literal(1),
  secrets: z.record(z.string(), z.string()),
});

type ProviderRecord = z.infer<typeof providerRecordSchema>;

export type ProviderView = ProviderRecord & {
  displayName: string;
  recommendedModels: string[];
  hasSecret: boolean;
};

export type SaveProviderInput = {
  providerId: ProviderId;
  baseUrl: string;
  model: string;
  apiKey?: string;
};

export type ResolvedProviderConfig = ProviderConnectionConfig & {
  apiKey: string;
};

export class ProviderConfigStore {
  private readonly crypto: CredentialCrypto;
  private readonly providersPath: string;
  private readonly secretsPath: string;

  constructor(options: { rootDir: string; crypto: CredentialCrypto }) {
    this.crypto = options.crypto;
    this.providersPath = join(options.rootDir, "providers.json");
    this.secretsPath = join(options.rootDir, "secrets.json");
  }

  async list(): Promise<ProviderView[]> {
    const [{ providers }, { secrets }] = await Promise.all([
      this.readProviders(),
      this.readSecrets(),
    ]);
    return providers.map((provider) => ({
      ...provider,
      displayName: PROVIDER_PRESETS[provider.providerId].displayName,
      recommendedModels: PROVIDER_PRESETS[provider.providerId].recommendedModels,
      hasSecret: Boolean(secrets[provider.providerId]),
    }));
  }

  async save(input: SaveProviderInput): Promise<ProviderView> {
    const apiKey = input.apiKey?.trim();
    if (apiKey && !this.crypto.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable");
    }
    if (!input.baseUrl.trim()) {
      throw new Error("Provider base URL is required");
    }
    if (!input.model.trim()) {
      throw new Error("Provider model ID is required");
    }

    const providersFile = await this.readProviders();
    const existing = providersFile.providers.find((provider) => provider.providerId === input.providerId);
    const nextRecord: ProviderRecord = {
      providerId: input.providerId,
      baseUrl: input.baseUrl.trim(),
      model: input.model.trim(),
      isDefault: existing?.isDefault ?? false,
      lastTestStatus: existing?.lastTestStatus ?? "untested",
      ...(existing?.lastTestedAt ? { lastTestedAt: existing.lastTestedAt } : {}),
    };
    providersFile.providers = providersFile.providers.map((provider) =>
      provider.providerId === input.providerId ? nextRecord : provider,
    );
    await writeJsonAtomic(this.providersPath, providersFile);

    if (apiKey) {
      const secretsFile = await this.readSecrets();
      secretsFile.secrets[input.providerId] = this.crypto.encryptString(apiKey).toString("base64");
      await writeJsonAtomic(this.secretsPath, secretsFile);
    }

    const view = (await this.list()).find((provider) => provider.providerId === input.providerId);
    if (!view) {
      throw new Error(`Provider configuration not found: ${input.providerId}`);
    }
    return view;
  }

  async clearSecret(providerId: ProviderId): Promise<void> {
    const secretsFile = await this.readSecrets();
    delete secretsFile.secrets[providerId];
    await writeJsonAtomic(this.secretsPath, secretsFile);
  }

  async setDefault(providerId: ProviderId): Promise<void> {
    const providersFile = await this.readProviders();
    providersFile.providers = providersFile.providers.map((provider) => ({
      ...provider,
      isDefault: provider.providerId === providerId,
    }));
    await writeJsonAtomic(this.providersPath, providersFile);
  }

  async recordTest(providerId: ProviderId, status: "success" | "failed"): Promise<void> {
    const providersFile = await this.readProviders();
    providersFile.providers = providersFile.providers.map((provider) =>
      provider.providerId === providerId
        ? {
            ...provider,
            lastTestStatus: status,
            lastTestedAt: new Date().toISOString(),
          }
        : provider,
    );
    await writeJsonAtomic(this.providersPath, providersFile);
  }

  async resolve(providerId: ProviderId): Promise<ResolvedProviderConfig> {
    const [{ providers }, { secrets }] = await Promise.all([
      this.readProviders(),
      this.readSecrets(),
    ]);
    const provider = providers.find((candidate) => candidate.providerId === providerId);
    if (!provider) {
      throw new Error(`Provider configuration not found: ${providerId}`);
    }
    if (!provider.model.trim()) {
      throw new Error(`No model configured for ${PROVIDER_PRESETS[providerId].displayName}`);
    }
    const encryptedSecret = secrets[providerId];
    if (!encryptedSecret) {
      throw new Error(`No API key configured for ${PROVIDER_PRESETS[providerId].displayName}`);
    }
    if (!this.crypto.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable");
    }
    return {
      providerId,
      baseUrl: provider.baseUrl,
      model: provider.model,
      apiKey: this.crypto.decryptString(Buffer.from(encryptedSecret, "base64")),
    };
  }

  private readProviders() {
    return readJson(this.providersPath, providersFileSchema, createDefaultProvidersFile());
  }

  private readSecrets() {
    return readJson(this.secretsPath, secretsFileSchema, {
      schemaVersion: 1 as const,
      secrets: {},
    });
  }
}

function createDefaultProvidersFile() {
  return {
    schemaVersion: 1 as const,
    providers: Object.values(PROVIDER_PRESETS).map((preset) => ({
      providerId: preset.id,
      baseUrl: preset.baseUrl,
      model: preset.recommendedModels[0] ?? "",
      isDefault: preset.default ?? false,
      lastTestStatus: "untested" as const,
    })),
  };
}
