// @vitest-environment node

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppSettingsStore } from "../app-settings-store";

const defaultSettings = {
  schemaVersion: 1,
  responseMode: "auto",
  developerMode: false,
  commandExecutionMode: "sentinel",
  webAccessEnabled: false,
  webSearchCoverage: "focused",
} as const;

describe("AppSettingsStore", () => {
  it("defaults response mode to auto", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    const store = new AppSettingsStore({ rootDir });

    await expect(store.get()).resolves.toEqual(defaultSettings);
  });

  it("persists the selected response mode", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    const store = new AppSettingsStore({ rootDir });

    await expect(store.save({ responseMode: "smooth" })).resolves.toEqual({
      ...defaultSettings,
      responseMode: "smooth",
    });
    await expect(new AppSettingsStore({ rootDir }).get()).resolves.toEqual({
      ...defaultSettings,
      responseMode: "smooth",
    });
    await expect(readFile(join(rootDir, "settings.json"), "utf8")).resolves.toContain(
      "\"responseMode\": \"smooth\"",
    );
  });

  it("persists developer mode without changing the response mode", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    const store = new AppSettingsStore({ rootDir });

    await expect(store.save({ developerMode: true })).resolves.toEqual({
      ...defaultSettings,
      developerMode: true,
    });
    await expect(store.save({ responseMode: "smooth" })).resolves.toEqual({
      ...defaultSettings,
      responseMode: "smooth",
      developerMode: true,
    });
  });

  it("persists command execution mode without changing other settings", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    const store = new AppSettingsStore({ rootDir });

    await expect(store.save({ commandExecutionMode: "cruise" })).resolves.toEqual({
      ...defaultSettings,
      commandExecutionMode: "cruise",
    });
    await expect(store.save({ developerMode: true })).resolves.toEqual({
      ...defaultSettings,
      developerMode: true,
      commandExecutionMode: "cruise",
    });
  });

  it("persists web access settings without changing other settings", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    const store = new AppSettingsStore({ rootDir });

    await expect(store.save({
      webAccessEnabled: true,
      webSearchCoverage: "wide",
    })).resolves.toEqual({
      ...defaultSettings,
      webAccessEnabled: true,
      webSearchCoverage: "wide",
    });
    await expect(store.save({ responseMode: "smooth" })).resolves.toEqual({
      ...defaultSettings,
      responseMode: "smooth",
      webAccessEnabled: true,
      webSearchCoverage: "wide",
    });
  });
});
