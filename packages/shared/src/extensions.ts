export type SkillView = {
  id: string;
  name: string;
  description: string;
  invocationName: `/${string}`;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
};

export type InstalledSkillRecord = SkillView & {
  rootDir: string;
  entrypointPath: string;
  body: string;
  contentHash: string;
};

export type McpTransport = "stdio" | "http" | "sse" | "ws";

export type McpToolView = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpServerView = {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  status: "untested" | "success" | "failed";
  lastTestedAt?: string;
  lastError?: string;
  tools: McpToolView[];
};

export type McpConfigView = {
  schemaVersion: 1;
  rawJson: string;
  servers: McpServerView[];
};
