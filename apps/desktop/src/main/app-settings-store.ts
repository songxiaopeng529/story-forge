import type {
  AppLanguage,
  AppSettingsView,
  CommandExecutionMode,
  SoulMode,
  WebSearchCoverage,
} from "@story-forge/shared";
import { join } from "node:path";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "@story-forge/agent";

const commandExecutionModeSchema = z.enum(["sentinel", "cruise", "unleashed"]);
const webSearchCoverageSchema = z.enum(["focused", "wide"]);
const languageSchema = z.enum(["en", "zh"]);
const soulModeSchema = z.enum(["off", "manual", "ask"]);

const appSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  language: languageSchema.default("en"),
  developerMode: z.boolean().default(false),
  commandExecutionMode: commandExecutionModeSchema.default("sentinel"),
  webAccessEnabled: z.boolean().default(false),
  webSearchCoverage: webSearchCoverageSchema.default("focused"),
  soulMode: soulModeSchema.default("ask"),
});

export type SaveAppSettingsInput = {
  language?: AppLanguage | undefined;
  developerMode?: boolean | undefined;
  commandExecutionMode?: CommandExecutionMode | undefined;
  webAccessEnabled?: boolean | undefined;
  webSearchCoverage?: WebSearchCoverage | undefined;
  soulMode?: SoulMode | undefined;
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
    language: "en",
    developerMode: false,
    commandExecutionMode: "sentinel",
    webAccessEnabled: false,
    webSearchCoverage: "focused",
    soulMode: "ask",
  };
}
