// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ProviderConfigStore } from "../provider-config-store";
import { ProviderService } from "../provider-service";

describe("ProviderService", () => {
  it("discovers models with the decrypted key without returning the key", async () => {
    const store = await createStore();
    const discoverModels = vi.fn(async () => ["deepseek-v4-pro"]);
    const service = new ProviderService({
      store,
      registry: { discoverModels },
    });

    await expect(service.test("deepseek")).resolves.toEqual({
      models: ["deepseek-v4-pro"],
    });
    expect(discoverModels).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "deepseek" }),
      "local-secret",
    );
    expect(await service.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "deepseek",
          hasSecret: true,
          lastTestStatus: "success",
        }),
      ]),
    );
  });

  it("redacts the decrypted key from discovery failures", async () => {
    const store = await createStore();
    const service = new ProviderService({
      store,
      registry: {
        discoverModels: async () => {
          throw new Error("request exposed local-secret");
        },
      },
    });

    await expect(service.discoverModels("deepseek")).rejects.toThrow(
      "request exposed [REDACTED]",
    );
  });
});

async function createStore(): Promise<ProviderConfigStore> {
  const rootDir = await mkdtemp(join(tmpdir(), "story-forge-provider-service-"));
  const store = new ProviderConfigStore({
    rootDir,
    crypto: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${value}`),
      decryptString: (value) => value.toString().replace(/^encrypted:/, ""),
    },
  });
  await store.save({
    providerId: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    apiKey: "local-secret",
  });
  return store;
}
