import type { SoulMode } from "./soul";

export type MessageDeliveryMode = "live" | "smooth";

export type CommandExecutionMode = "sentinel" | "cruise" | "unleashed";

export type WebSearchCoverage = "focused" | "wide";

export type AppLanguage = "en" | "zh";

export type { SoulMode } from "./soul";

export type AppSettingsView = {
  schemaVersion: 1;
  language: AppLanguage;
  developerMode: boolean;
  commandExecutionMode: CommandExecutionMode;
  webAccessEnabled: boolean;
  webSearchCoverage: WebSearchCoverage;
  soulMode: SoulMode;
};
