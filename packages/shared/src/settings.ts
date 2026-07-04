export type ResponseMode = "auto" | "live" | "smooth";

export type MessageDeliveryMode = "live" | "smooth";

export type CommandExecutionMode = "sentinel" | "cruise" | "unleashed";

export type WebSearchCoverage = "focused" | "wide";

export type AgentRuntimeKind = "native" | "pi";

export type AgentRuntimeDescriptor = {
  kind: AgentRuntimeKind;
  label: string;
  description: string;
  experimental?: boolean;
};

export const AGENT_RUNTIMES = [
  {
    kind: "native",
    label: "StoryForge Native Runtime",
    description: "Uses StoryForge's built-in agent loop and model gateway.",
  },
  {
    kind: "pi",
    label: "PI Agent Runtime",
    description: "Uses the PI Agent loop while keeping StoryForge tools and safety controls.",
    experimental: true,
  },
] as const satisfies readonly AgentRuntimeDescriptor[];

export type AppSettingsView = {
  schemaVersion: 1;
  runtimeKind: AgentRuntimeKind;
  responseMode: ResponseMode;
  developerMode: boolean;
  commandExecutionMode: CommandExecutionMode;
  webAccessEnabled: boolean;
  webSearchCoverage: WebSearchCoverage;
};
