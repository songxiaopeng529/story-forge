import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PiModelService } from "../pi-model-service";

describe("PiModelService", () => {
  it("registers the StoryForge-managed Volcano Engine provider", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-pi-models-"));
    try {
      const service = new PiModelService({ rootDir });

      const providers = await service.list();
      const volcano = providers.find((provider) => provider.providerId === "volcano");

      expect(volcano).toMatchObject({
        providerId: "volcano",
        displayName: "Volcano Engine (火山引擎)",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        model: "doubao-seed-2-0-lite-260215",
        lastTestStatus: "untested",
      });
      expect(volcano?.recommendedModels).toContain("ep-your-endpoint-id");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("persists Volcano provider overrides and reveals stored API keys", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-pi-models-"));
    try {
      const service = new PiModelService({ rootDir });

      const saved = await service.save({
        providerId: "volcano",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        model: "ep-custom-endpoint",
        apiKey: "ark-secret",
      });

      expect(saved).toMatchObject({
        providerId: "volcano",
        model: "ep-custom-endpoint",
        hasSecret: true,
      });
      await expect(service.revealSecret("volcano")).resolves.toBe("ark-secret");
      const auth = JSON.parse(
        await readFile(join(rootDir, "agent", "auth.json"), "utf8"),
      ) as Record<string, { type?: string; key?: string }>;
      expect(auth.volcano).toEqual({ type: "api_key", key: "ark-secret" });
      const overrides = JSON.parse(
        await readFile(
          join(rootDir, "agent", "storyforge-provider-overrides.json"),
          "utf8",
        ),
      ) as { providers?: Record<string, { model?: string }> };
      expect(overrides.providers?.volcano?.model).toBe("ep-custom-endpoint");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("persists custom model IDs for PI built-in providers", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-pi-models-"));
    try {
      const service = new PiModelService({ rootDir });

      const saved = await service.save({
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-custom-coder",
        apiKey: "deepseek-secret",
      });

      expect(saved).toMatchObject({
        providerId: "deepseek",
        model: "deepseek-custom-coder",
        hasSecret: true,
      });
      expect(saved.recommendedModels).toContain("deepseek-custom-coder");
      await expect(service.resolveModel("deepseek", "deepseek-custom-coder"))
        .resolves.toMatchObject({
          provider: "deepseek",
          id: "deepseek-custom-coder",
          baseUrl: "https://api.deepseek.com",
        });

      const overrides = JSON.parse(
        await readFile(
          join(rootDir, "agent", "storyforge-provider-overrides.json"),
          "utf8",
        ),
      ) as { providers?: Record<string, { baseUrl?: string; model?: string }> };
      expect(overrides.providers?.deepseek).toEqual({
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-custom-coder",
      });

      const restarted = new PiModelService({ rootDir });
      const restartedProvider = (await restarted.list())
        .find((provider) => provider.providerId === "deepseek");
      expect(restartedProvider?.recommendedModels).toContain("deepseek-custom-coder");
      await expect(restarted.resolveModel("deepseek", "deepseek-custom-coder"))
        .resolves.toMatchObject({
          provider: "deepseek",
          id: "deepseek-custom-coder",
        });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("keeps provider saving separate from selecting an exact default model", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-pi-models-"));
    try {
      const service = new PiModelService({ rootDir });
      await service.save({
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-custom-default",
        apiKey: "deepseek-secret",
      });
      expect((await service.list()).filter((provider) => provider.isDefault)).toHaveLength(0);

      await service.setDefault({
        providerId: "deepseek",
        model: "deepseek-custom-default",
      });
      await service.save({
        providerId: "volcano",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        model: "ep-custom-endpoint",
        apiKey: "ark-secret",
      });

      const afterSave = await service.list();
      const providerOrder = afterSave.map((provider) => provider.providerId);
      expect(afterSave.filter((provider) => provider.isDefault)).toHaveLength(1);
      expect(afterSave.find((provider) => provider.isDefault)).toMatchObject({
        providerId: "deepseek",
        defaultModel: "deepseek-custom-default",
      });

      await service.setDefault({
        providerId: "volcano",
        model: "ep-custom-endpoint",
      });
      const afterSelection = await service.list();
      expect(afterSelection.map((provider) => provider.providerId)).toEqual(providerOrder);
      expect(afterSelection.filter((provider) => provider.isDefault)).toHaveLength(1);
      expect(afterSelection.find((provider) => provider.isDefault)).toMatchObject({
        providerId: "volcano",
        defaultModel: "ep-custom-endpoint",
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
