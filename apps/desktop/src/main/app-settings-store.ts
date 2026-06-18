import type { AppSettingsView, ResponseMode } from "@story-forge/shared";
import { join } from "node:path";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "./atomic-json";

const responseModeSchema = z.enum(["auto", "live", "smooth"]);

const appSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  responseMode: responseModeSchema,
  developerMode: z.boolean().default(false),
});

export type SaveAppSettingsInput = {
  responseMode?: ResponseMode | undefined;
  developerMode?: boolean | undefined;
};

export class AppSettingsStore {
  private readonly settingsPath: string;

  constructor(options: { rootDir: string }) {
    this.settingsPath = join(options.rootDir, "settings.json");
  }

  get(): Promise<AppSettingsView> {
    return readJson(this.settingsPath, appSettingsSchema, createDefaultSettings());
  }

  async save(input: SaveAppSettingsInput): Promise<AppSettingsView> {
    const current = await this.get();
    const settings = appSettingsSchema.parse({
      ...current,
      ...input,
      schemaVersion: 1,
    });
    await writeJsonAtomic(this.settingsPath, settings);
    return settings;
  }
}

function createDefaultSettings(): AppSettingsView {
  return {
    schemaVersion: 1,
    responseMode: "auto",
    developerMode: false,
  };
}
