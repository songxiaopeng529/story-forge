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
  lastTestedAt?: string | undefined;
  lastError?: string | undefined;
  tools: McpToolView[];
};

export type McpConfigView = {
  schemaVersion: 1;
  rawJson: string;
  servers: McpServerView[];
};

export type AutomationStatus = "active" | "paused";
export type AutomationRunStatus = "scheduled" | "running" | "completed" | "failed" | "skipped";
export type AutomationKind = "scheduled_chat";

export type AutomationScheduleView = {
  sourceText: string;
  cron: string;
  timezone: string;
  summary: string;
};

export type AutomationView = {
  schemaVersion: 1;
  id: string;
  kind: AutomationKind;
  name: string;
  status: AutomationStatus;
  workspaceId: string;
  providerId: "deepseek" | "openai" | "anthropic" | "openrouter" | "volcano";
  model: string;
  schedule: AutomationScheduleView;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | undefined;
  nextRunAt?: string | undefined;
  lastRunStatus?: AutomationRunStatus | undefined;
};

export type AutomationRunView = {
  schemaVersion: 1;
  id: string;
  automationId: string;
  sessionId?: `sf_session_${string}` | undefined;
  status: AutomationRunStatus;
  scheduledFor: string;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  error?: string | undefined;
};

export type AutomationProposalView = {
  name: string;
  workspaceId: string;
  providerId: AutomationView["providerId"];
  model: string;
  scheduleText: string;
  cron: string;
  timezone: string;
  summary: string;
  nextRuns: string[];
  prompt: string;
};

export type ScheduleValidationResult =
  | {
      ok: true;
      cron: string;
      timezone: string;
      summary: string;
      nextRuns: string[];
    }
  | { ok: false; error: string };

export type CreateAutomationInput = {
  name: string;
  status: AutomationStatus;
  workspaceId: string;
  providerId: AutomationView["providerId"];
  model: string;
  schedule: AutomationScheduleView;
  prompt: string;
};

export type UpdateAutomationInput = {
  automationId: string;
  name?: string;
  status?: AutomationStatus;
  workspaceId?: string;
  providerId?: AutomationView["providerId"];
  model?: string;
  schedule?: AutomationScheduleView;
  prompt?: string;
};
