import type { SessionId, TurnId } from "./events";
import { createId } from "./utils";

export const AGENT_RUN_SCHEMA_VERSION = 1 as const;

export type AgentExecutionId = `sf_agent_execution_${string}`;
export type AgentEventId = `sf_agent_event_${string}`;

export const AGENT_ROLES = ["root", "explorer", "reviewer"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const CHILD_AGENT_ROLES = ["explorer", "reviewer"] as const;
export type ChildAgentRole = (typeof CHILD_AGENT_ROLES)[number];

export const AGENT_EXECUTION_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] as const;
export type AgentExecutionStatus = (typeof AGENT_EXECUTION_STATUSES)[number];

export const TERMINAL_AGENT_EXECUTION_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const;
export type TerminalAgentExecutionStatus =
  (typeof TERMINAL_AGENT_EXECUTION_STATUSES)[number];

export type AgentExecutionUsage = {
  turns: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
};

export type AgentEvidence = {
  path?: string;
  line?: number;
  detail: string;
};

export type AgentReport = {
  summary: string;
  findings: string[];
  evidence: AgentEvidence[];
  filesInspected: string[];
  unresolved: string[];
};

export type DelegateTaskInput = {
  role: ChildAgentRole;
  objective: string;
  scope?: string[];
  constraints?: string[];
  expectedOutput?: string;
};

export type AgentDelegateInput = {
  tasks: DelegateTaskInput[];
};

export type DelegateTaskResult = {
  executionId: AgentExecutionId;
  role: ChildAgentRole;
  status: TerminalAgentExecutionStatus;
  report?: AgentReport;
  error?: string;
  usage: AgentExecutionUsage;
  truncated: boolean;
};

export const DELEGATE_RESULT_STATUSES = [
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;
export type DelegateResultStatus = (typeof DELEGATE_RESULT_STATUSES)[number];

export type DelegateResult = {
  status: DelegateResultStatus;
  /** Results use the same order as the corresponding input tasks. */
  results: DelegateTaskResult[];
};

export type AgentExecutionView = {
  id: AgentExecutionId;
  parentExecutionId?: AgentExecutionId;
  role: AgentRole;
  objective: string;
  status: AgentExecutionStatus;
  attempt: number;
  providerId: string;
  model: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  usage: AgentExecutionUsage;
  report?: AgentReport;
  error?: string;
  truncated?: boolean;
};

export type AgentRunView = {
  schemaVersion: typeof AGENT_RUN_SCHEMA_VERSION;
  sessionId: SessionId;
  turnId: TurnId;
  rootExecutionId: AgentExecutionId;
  sequence: number;
  createdAt: string;
  updatedAt: string;
  executions: AgentExecutionView[];
};

export function createAgentExecutionId(): AgentExecutionId {
  return createId("agent_execution") as AgentExecutionId;
}

export function createAgentEventId(): AgentEventId {
  return createId("agent_event") as AgentEventId;
}

export function createEmptyAgentExecutionUsage(): AgentExecutionUsage {
  return {
    turns: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
}

export function isAgentExecutionId(value: unknown): value is AgentExecutionId {
  return typeof value === "string" && /^sf_agent_execution_[a-z0-9]+$/.test(value);
}

export function isAgentEventId(value: unknown): value is AgentEventId {
  return typeof value === "string" && /^sf_agent_event_[a-z0-9]+$/.test(value);
}

export function isAgentRole(value: unknown): value is AgentRole {
  return value === "root" || value === "explorer" || value === "reviewer";
}

export function isChildAgentRole(value: unknown): value is ChildAgentRole {
  return value === "explorer" || value === "reviewer";
}

export function isAgentExecutionStatus(value: unknown): value is AgentExecutionStatus {
  return AGENT_EXECUTION_STATUSES.some((status) => status === value);
}

export function isTerminalAgentExecutionStatus(
  value: unknown,
): value is TerminalAgentExecutionStatus {
  return TERMINAL_AGENT_EXECUTION_STATUSES.some((status) => status === value);
}

export function isDelegateResultStatus(value: unknown): value is DelegateResultStatus {
  return DELEGATE_RESULT_STATUSES.some((status) => status === value);
}
