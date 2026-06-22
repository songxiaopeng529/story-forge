import type { CommandExecutionMode, MessageDeliveryMode, ResponseMode } from "./settings";
import type { AutomationProposalView } from "./extensions";

export type SessionId = `sf_session_${string}`;
export type TurnId = `sf_turn_${string}`;
export type AgentStopReason =
  | "completed"
  | "user-stopped"
  | "time-limit"
  | "repeated-tool-call"
  | "consecutive-tool-failures"
  | "step-limit"
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

export type MemoryWriteEvent = {
  type: "memory.write";
  sessionId: SessionId;
  turnId: TurnId;
  key: string;
  value: string;
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

export type ModelRequestEvent = {
  type: "model.request";
  sessionId: SessionId;
  turnId: TurnId;
  requestId: string;
  providerId: string;
  model: string;
  responseMode: ResponseMode;
  messages: InspectableModelMessage[];
  tools: InspectableModelTool[];
};

export type AutomationProposalEvent = {
  type: "automation.proposal";
  sessionId: SessionId;
  turnId: TurnId;
  proposalId: string;
  proposal: AutomationProposalView;
};

export type AgentEvent =
  | RuntimeStartedEvent
  | RuntimeCompletedEvent
  | RuntimeErrorEvent
  | MessageDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | PermissionRequestEvent
  | MemoryWriteEvent
  | ResponseFallbackEvent
  | ModelRequestEvent
  | AutomationProposalEvent;

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
