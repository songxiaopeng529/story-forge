import type { CommandExecutionMode, MessageDeliveryMode } from "./settings";
import type { AutomationProposalView } from "./extensions";
import type { SessionTask, TaskId } from "./tasks";
import type {
  AgentEventId,
  AgentExecutionId,
  AgentExecutionUsage,
  AgentReport,
  ChildAgentRole,
} from "./agent-runs";

export type SessionId = `sf_session_${string}`;
export type TurnId = `sf_turn_${string}`;
export type AgentStopReason =
  | "completed"
  | "user-stopped"
  | "time-limit"
  | "repeated-tool-call"
  | "consecutive-tool-failures"
  | "step-limit"
  | "unfinished-tasks"
  | "unrecoverable-error";

export type AgentEventEnvelope = {
  eventId: AgentEventId;
  /** Monotonic within one StoryForge Turn. */
  sequence: number;
  occurredAt: string;
  sessionId: SessionId;
  turnId: TurnId;
  agentExecutionId: AgentExecutionId;
  parentAgentExecutionId?: AgentExecutionId;
};

export type RuntimeStartedEvent = AgentEventEnvelope & {
  type: "runtime.started";
  createdAt: string;
};

export type RuntimeCompletedEvent = AgentEventEnvelope & {
  type: "runtime.completed";
  stopReason?: AgentStopReason;
  steps?: number;
};

export type RuntimeErrorEvent = AgentEventEnvelope & {
  type: "runtime.error";
  message: string;
  stopReason?: AgentStopReason;
  steps?: number;
};

export type MessageDeltaEvent = AgentEventEnvelope & {
  type: "message.delta";
  content: string;
  delivery?: MessageDeliveryMode;
};

export type ToolCallEvent = AgentEventEnvelope & {
  type: "tool.call";
  callId: string;
  name: string;
  input: unknown;
};

export type ToolResultEvent = AgentEventEnvelope & {
  type: "tool.result";
  callId: string;
  name: string;
  ok: boolean;
  output: unknown;
};

export type PermissionRequestEvent = AgentEventEnvelope & {
  type: "permission.request";
  requestId: string;
  reason: string;
  command: {
    program: string;
    args: string[];
    cwd: string;
  };
  mode: CommandExecutionMode;
  risk: "unknown" | "high" | "destructive" | "elevated";
};

type ExtensionUiEventBase = AgentEventEnvelope & {
  requestId: string;
};

export type ExtensionUiRequestEvent = ExtensionUiEventBase & (
  | {
      type: "extension.ui.request";
      method: "select";
      title: string;
      options: string[];
    }
  | {
      type: "extension.ui.request";
      method: "confirm";
      title: string;
      message: string;
    }
  | {
      type: "extension.ui.request";
      method: "input";
      title: string;
      placeholder?: string;
    }
  | {
      type: "extension.ui.request";
      method: "editor";
      title: string;
      prefill?: string;
    }
);

export type ExtensionUiResponse = {
  requestId: string;
  cancelled?: boolean;
  value?: string;
  confirmed?: boolean;
};

export type ExtensionNotificationEvent = AgentEventEnvelope & {
  type: "extension.notification";
  message: string;
  level: "info" | "warning" | "error";
};

export type ExtensionStatusEvent = AgentEventEnvelope & {
  type: "extension.status";
  key: string;
  text?: string;
};

export type ExtensionWidgetEvent = AgentEventEnvelope & {
  type: "extension.widget";
  key: string;
  lines?: string[];
};

export type HumanInputQuestionType = "single_select" | "multi_select" | "text";

export type HumanInputOption = {
  id: string;
  label: string;
  description?: string;
};

export type HumanInputQuestion = {
  id: string;
  header: string;
  question: string;
  type: HumanInputQuestionType;
  options?: HumanInputOption[];
  allowOther?: boolean;
  required?: boolean;
};

export type HumanInputRemark = {
  enabled: boolean;
  label?: string;
  placeholder?: string;
  required?: boolean;
};

export type HumanInputRequestPayload = {
  title: string;
  description?: string;
  questions: HumanInputQuestion[];
  remark?: HumanInputRemark;
};

export type HumanInputRequestEvent = HumanInputRequestPayload & AgentEventEnvelope & {
  type: "human.input.request";
  requestId: string;
};

export type HumanInputAnswer = {
  id: string;
  header: string;
  question: string;
  type: HumanInputQuestionType;
  selectedOptionIds?: string[];
  selectedLabels?: string[];
  text?: string;
};

export type HumanInputResponse = {
  requestId: string;
  cancelled?: boolean;
  answers?: HumanInputAnswer[];
  remark?: string;
};

export type ResponseFallbackEvent = AgentEventEnvelope & {
  type: "response.fallback";
  from: "live";
  to: "smooth";
  reason: string;
};

export type InspectableModelMessage =
  | { role: "system"; content: string }
  | {
      role: "user";
      content: string | Array<
        | { type: "text"; text: string }
        | { type: "image"; mediaType: string; data: string; filename?: string }
      >;
    }
  | {
      role: "assistant";
      content: string;
      reasoningContent?: string;
      toolCalls?: Array<{ id: string; name: string; input: unknown }>;
    }
  | { role: "tool"; content: string; name: string; toolCallId: string };

export type InspectableModelTool = {
  name: string;
  description: string;
  parameters: unknown;
};

export type RuntimeEnvironmentView = {
  currentDate: string;
  timezone: string;
};

export type InspectableSoulContext = {
  status: "active" | "empty";
  filePath: string;
  byteLength: number;
};

export type ModelRequestEvent = AgentEventEnvelope & {
  type: "model.request";
  requestId: string;
  providerId: string;
  model: string;
  messages: InspectableModelMessage[];
  tools: InspectableModelTool[];
  environment?: RuntimeEnvironmentView;
  soul?: InspectableSoulContext;
};

export type ContextUsageSource = "provider" | "estimate";

export type ContextUsageEvent = AgentEventEnvelope & {
  type: "context.usage";
  usedTokens: number;
  budgetTokens: number;
  windowTokens: number;
  source: ContextUsageSource;
};

export type ContextCompactedEvent = AgentEventEnvelope & {
  type: "context.compacted";
  trigger: "auto" | "manual";
  beforeTokens?: number;
  afterTokens?: number;
  budgetTokens?: number;
  retainedRounds?: number;
};

export type AutomationProposalEvent = AgentEventEnvelope & {
  type: "automation.proposal";
  proposalId: string;
  proposal: AutomationProposalView;
};

export type TaskListUpdatedEvent = AgentEventEnvelope & {
  type: "task.list.updated";
  tasks: SessionTask[];
  changedTaskId?: TaskId;
  reason: "created" | "updated" | "loaded" | "guard";
};

export type AgentExecutionQueuedEvent = AgentEventEnvelope & {
  type: "agent.execution.queued";
  role: ChildAgentRole;
  objective: string;
};

export type AgentExecutionStartedEvent = AgentEventEnvelope & {
  type: "agent.execution.started";
};

export type AgentExecutionCompletedEvent = AgentEventEnvelope & {
  type: "agent.execution.completed";
  usage: AgentExecutionUsage;
  report: AgentReport;
  truncated: boolean;
};

export type AgentExecutionFailedEvent = AgentEventEnvelope & {
  type: "agent.execution.failed";
  usage: AgentExecutionUsage;
  error: string;
};

export type AgentExecutionCancelledEvent = AgentEventEnvelope & {
  type: "agent.execution.cancelled";
};

export type AgentEvent =
  | RuntimeStartedEvent
  | RuntimeCompletedEvent
  | RuntimeErrorEvent
  | MessageDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | PermissionRequestEvent
  | ExtensionUiRequestEvent
  | ExtensionNotificationEvent
  | ExtensionStatusEvent
  | ExtensionWidgetEvent
  | HumanInputRequestEvent
  | ResponseFallbackEvent
  | ModelRequestEvent
  | ContextUsageEvent
  | ContextCompactedEvent
  | AutomationProposalEvent
  | TaskListUpdatedEvent
  | AgentExecutionQueuedEvent
  | AgentExecutionStartedEvent
  | AgentExecutionCompletedEvent
  | AgentExecutionFailedEvent
  | AgentExecutionCancelledEvent;

type LiveEnvelopeKey =
  | "eventId"
  | "sequence"
  | "occurredAt"
  | "agentExecutionId"
  | "parentAgentExecutionId";

type RemoveLiveEnvelope<T> = T extends unknown ? Omit<T, LiveEnvelopeKey> : never;

/** Events emitted by a worker before the coordinator attributes and sequences them. */
export type UnsequencedAgentEvent = RemoveLiveEnvelope<AgentEvent>;

export function createSessionId(): SessionId {
  const entropy = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

  return `sf_session_${entropy}`;
}

export function createTurnId(): TurnId {
  const entropy = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

  return `sf_turn_${entropy}`;
}

export type TerminalAgentEvent = RuntimeCompletedEvent | RuntimeErrorEvent;

export function isTerminalAgentEvent(event: AgentEvent): event is TerminalAgentEvent {
  return event.parentAgentExecutionId === undefined
    && (event.type === "runtime.completed" || event.type === "runtime.error");
}

export function hasAgentEventEnvelope(value: unknown): value is AgentEventEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const event = value as Partial<AgentEventEnvelope>;
  return typeof event.eventId === "string"
    && typeof event.sequence === "number"
    && Number.isSafeInteger(event.sequence)
    && event.sequence > 0
    && typeof event.occurredAt === "string"
    && typeof event.sessionId === "string"
    && typeof event.turnId === "string"
    && typeof event.agentExecutionId === "string";
}
