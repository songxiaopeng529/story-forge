export type ResponseMode = "auto" | "live" | "smooth";

export type MessageDeliveryMode = "live" | "smooth";

export type AppSettingsView = {
  schemaVersion: 1;
  responseMode: ResponseMode;
  developerMode: boolean;
};
