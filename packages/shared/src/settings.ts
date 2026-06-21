export type ResponseMode = "auto" | "live" | "smooth";

export type MessageDeliveryMode = "live" | "smooth";

export type CommandExecutionMode = "sentinel" | "cruise" | "unleashed";

export type WebSearchCoverage = "focused" | "wide";

export type AppSettingsView = {
  schemaVersion: 1;
  responseMode: ResponseMode;
  developerMode: boolean;
  commandExecutionMode: CommandExecutionMode;
  webAccessEnabled: boolean;
  webSearchCoverage: WebSearchCoverage;
};
