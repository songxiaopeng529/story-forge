// @vitest-environment node

import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderConfigStore } from "./provider-config-store";

describe("ProviderConfigStore", () => {
  it("stores public configuration separately from encrypted secrets", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-provider-"));
    const crypto = fakeCrypto();
    const store = new ProviderConfigStore({ rootDir, crypto });

    await store.save({
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      apiKey: "secret-value",
    });

    const providersFile = await readFile(join(rootDir, "providers.json"), "utf8");
    const secretsFile = await readFile(join(rootDir, "secrets.json"), "utf8");
    expect(providersFile).not.toContain("secret-value");
    expect(secretsFile).not.toContain("secret-value");
    expect(secretsFile).toContain(Buffer.from("encrypted:secret-value").toString("base64"));
    expect((await stat(join(rootDir, "secrets.json"))).mode & 0o777).toBe(0o600);

    await expect(store.resolve("deepseek")).resolves.toMatchObject({
      providerId: "deepseek",
      apiKey: "secret-value",
    });
    expect((await store.list()).find((provider) => provider.providerId === "deepseek")).toMatchObject({
      hasSecret: true,
      isDefault: true,
    });
  });

  it("preserves an existing key when an empty key is saved and clears only explicitly", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-provider-"));
    const store = new ProviderConfigStore({ rootDir, crypto: fakeCrypto() });

    await store.save({
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      apiKey: "keep-me",
    });
    await store.save({
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "custom-model",
      apiKey: "",
    });

    await expect(store.resolve("deepseek")).resolves.toMatchObject({
      apiKey: "keep-me",
      model: "custom-model",
    });
    await store.clearSecret("deepseek");
    await expect(store.resolve("deepseek")).rejects.toThrow("No API key configured for DeepSeek");
  });

  it("refuses to persist a plaintext key when encryption is unavailable", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-provider-"));
    const store = new ProviderConfigStore({
      rootDir,
      crypto: {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.alloc(0),
        decryptString: () => "",
      },
    });

    await expect(
      store.save({
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-test",
        apiKey: "must-not-be-written",
      }),
    ).rejects.toThrow("Secure credential storage is unavailable");
  });
});

function fakeCrypto() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, ""),
  };
}
