import type { CommandExecutionMode, MessageDeliveryMode } from "./settings";
import type { AutomationProposalView } from "./extensions";
import type { SessionTask, TaskId } from "./tasks";

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

export type RuntimeStartedEvent = {
  type: "runtime.started";
  sessionId: SessionId;
  turnId: TurnId;
  createdAt: string;
};

export type RuntimeCompletedEvent = {
  type: "runtime.completed";
  sessionId: SessionId;
  turnId: TurnId;
  stopReason?: AgentStopReason;
  steps?: number;
};

export type RuntimeErrorEvent = {
  type: "runtime.error";
  sessionId: SessionId;
  turnId: TurnId;
  message: string;
  stopReason?: AgentStopReason;
  steps?: number;
};

export type MessageDeltaEvent = {
  type: "message.delta";
  sessionId: SessionId;
  turnId: TurnId;
  content: string;
  delivery?: MessageDeliveryMode;
};

export type ToolCallEvent = {
  type: "tool.call";
  sessionId: SessionId;
  turnId: TurnId;
  callId: string;
  name: string;
  input: unknown;
};

export type ToolResultEvent = {
  type: "tool.result";
  sessionId: SessionId;
  turnId: TurnId;
  callId: string;
  name: string;
  ok: boolean;
  output: unknown;
};

export type PermissionRequestEvent = {
  type: "permission.request";
  sessionId: SessionId;
  turnId: TurnId;
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

type ExtensionUiEventBase = {
  sessionId: SessionId;
  turnId: TurnId;
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

export type ExtensionNotificationEvent = {
  type: "extension.notification";
  sessionId: SessionId;
  turnId: TurnId;
  message: string;
  level: "info" | "warning" | "error";
};

export type ExtensionStatusEvent = {
  type: "extension.status";
  sessionId: SessionId;
  turnId: TurnId;
  key: string;
  text?: string;
};

export type ExtensionWidgetEvent = {
  type: "extension.widget";
  sessionId: SessionId;
  turnId: TurnId;
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

export type HumanInputRequestEvent = HumanInputRequestPayload & {
  type: "human.input.request";
  sessionId: SessionId;
  turnId: TurnId;
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

export type ResponseFallbackEvent = {
  type: "response.fallback";
  sessionId: SessionId;
  turnId: TurnId;
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

export type ModelRequestEvent = {
  type: "model.request";
  sessionId: SessionId;
  turnId: TurnId;
  requestId: string;
  providerId: string;
  model: string;
  messages: InspectableModelMessage[];
  tools: InspectableModelTool[];
  environment?: RuntimeEnvironmentView;
  soul?: InspectableSoulContext;
};

export type ContextUsageSource = "provider" | "estimate";

export type ContextUsageEvent = {
  type: "context.usage";
  sessionId: SessionId;
  turnId: TurnId;
  usedTokens: number;
  budgetTokens: number;
  windowTokens: number;
  source: ContextUsageSource;
};

export type ContextCompactedEvent = {
  type: "context.compacted";
  sessionId: SessionId;
  turnId: TurnId;
  trigger: "auto" | "manual";
  beforeTokens?: number;
  afterTokens?: number;
  budgetTokens?: number;
  retainedRounds?: number;
};

export type AutomationProposalEvent = {
  type: "automation.proposal";
  sessionId: SessionId;
  turnId: TurnId;
  proposalId: string;
  proposal: AutomationProposalView;
};

export type TaskListUpdatedEvent = {
  type: "task.list.updated";
  sessionId: SessionId;
  turnId: TurnId;
  tasks: SessionTask[];
  changedTaskId?: TaskId;
  reason: "created" | "updated" | "loaded" | "guard";
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
  | TaskListUpdatedEvent;

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
  return event.type === "runtime.completed" || event.type === "runtime.error";
}
