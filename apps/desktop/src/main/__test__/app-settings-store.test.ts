// @vitest-environment node

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppSettingsStore } from "../app-settings-store";

const defaultSettings = {
  schemaVersion: 1,
  language: "en",
  developerMode: false,
  commandExecutionMode: "sentinel",
  webAccessEnabled: false,
  webSearchCoverage: "focused",
} as const;

describe("AppSettingsStore", () => {
  it("defaults PI desktop settings", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    const store = new AppSettingsStore({ rootDir });

    await expect(store.get()).resolves.toEqual(defaultSettings);
  });

  it("drops legacy runtime selector fields from old settings files", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    await writeFile(join(rootDir, "settings.json"), `${JSON.stringify({
      schemaVersion: 1,
      runtimeKind: "native",
      responseMode: "smooth",
      developerMode: true,
      commandExecutionMode: "cruise",
      webAccessEnabled: true,
      webSearchCoverage: "wide",
    })}\n`);
    const store = new AppSettingsStore({ rootDir });

    await expect(store.get()).resolves.toEqual({
      ...defaultSettings,
      developerMode: true,
      commandExecutionMode: "cruise",
      webAccessEnabled: true,
      webSearchCoverage: "wide",
    });
    await store.save({ developerMode: false });
    const persisted = await readFile(join(rootDir, "settings.json"), "utf8");
    expect(persisted).not.toContain("runtimeKind");
    expect(persisted).not.toContain("responseMode");
  });

  it("persists developer mode without changing other settings", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    const store = new AppSettingsStore({ rootDir });

    await expect(store.save({ developerMode: true })).resolves.toEqual({
      ...defaultSettings,
      developerMode: true,
    });
  });

  it("persists language without changing other settings", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    const store = new AppSettingsStore({ rootDir });

    await expect(store.save({ language: "zh" })).resolves.toEqual({
      ...defaultSettings,
      language: "zh",
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
  });
});
