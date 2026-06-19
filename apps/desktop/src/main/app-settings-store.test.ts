// @vitest-environment node

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppSettingsStore } from "./app-settings-store";

describe("AppSettingsStore", () => {
  it("defaults response mode to auto", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    const store = new AppSettingsStore({ rootDir });

    await expect(store.get()).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "auto",
      developerMode: false,
      commandExecutionMode: "sentinel",
    });
  });

  it("persists the selected response mode", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    const store = new AppSettingsStore({ rootDir });

    await expect(store.save({ responseMode: "smooth" })).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "smooth",
      developerMode: false,
      commandExecutionMode: "sentinel",
    });
    await expect(new AppSettingsStore({ rootDir }).get()).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "smooth",
      developerMode: false,
      commandExecutionMode: "sentinel",
    });
    await expect(readFile(join(rootDir, "settings.json"), "utf8")).resolves.toContain(
      "\"responseMode\": \"smooth\"",
    );
  });

  it("persists developer mode without changing the response mode", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    const store = new AppSettingsStore({ rootDir });

    await expect(store.save({ developerMode: true })).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "auto",
      developerMode: true,
      commandExecutionMode: "sentinel",
    });
    await expect(store.save({ responseMode: "smooth" })).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "smooth",
      developerMode: true,
      commandExecutionMode: "sentinel",
    });
  });

  it("persists command execution mode without changing other settings", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-settings-"));
    const store = new AppSettingsStore({ rootDir });

    await expect(store.save({ commandExecutionMode: "cruise" })).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "auto",
      developerMode: false,
      commandExecutionMode: "cruise",
    });
    await expect(store.save({ developerMode: true })).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "auto",
      developerMode: true,
      commandExecutionMode: "cruise",
    });
  });
});
