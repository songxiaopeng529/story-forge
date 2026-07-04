// @vitest-environment node

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppSettingsStore } from "../app-settings-store";

const defaultSettings = {
  schemaVersion: 1,
  runtimeKind: "native",
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

  it("persists the selected agent runtime", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    const store = new AppSettingsStore({ rootDir });

    await expect(store.save({ runtimeKind: "pi" })).resolves.toEqual({
      ...defaultSettings,
      runtimeKind: "pi",
    });
    await expect(new AppSettingsStore({ rootDir }).get()).resolves.toEqual({
      ...defaultSettings,
      runtimeKind: "pi",
    });
    await expect(readFile(join(rootDir, "settings.json"), "utf8")).resolves.toContain(
      "\"runtimeKind\": \"pi\"",
    );
  });

  it("defaults old settings files to the native runtime", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    await writeFile(join(rootDir, "settings.json"), `${JSON.stringify({
      schemaVersion: 1,
      responseMode: "smooth",
      developerMode: true,
      commandExecutionMode: "cruise",
      webAccessEnabled: true,
      webSearchCoverage: "wide",
    })}\n`);
    const store = new AppSettingsStore({ rootDir });

    await expect(store.get()).resolves.toEqual({
      ...defaultSettings,
      runtimeKind: "native",
      responseMode: "smooth",
      developerMode: true,
      commandExecutionMode: "cruise",
      webAccessEnabled: true,
      webSearchCoverage: "wide",
    });
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
