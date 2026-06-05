export type SessionId = `sf_session_${string}`;

export type RuntimeStartedEvent = {
  type: "runtime.started";
  sessionId: SessionId;
};

export type RuntimeCompletedEvent = {
  type: "runtime.completed";
  sessionId?: SessionId;
};

export type RuntimeErrorEvent = {
  type: "runtime.error";
  sessionId?: SessionId;
  error: {
    message: string;
    code?: string;
  };
};

export type MessageDeltaEvent = {
  type: "message.delta";
  sessionId?: SessionId;
  delta: string;
};

export type ToolCallEvent = {
  type: "tool.call";
  sessionId?: SessionId;
  toolName: string;
  callId: string;
  input: unknown;
};

export type ToolResultEvent = {
  type: "tool.result";
  sessionId?: SessionId;
  toolName: string;
  callId: string;
  output: unknown;
};

export type PermissionRequestEvent = {
  type: "permission.request";
  sessionId?: SessionId;
  requestId: string;
  reason: string;
};

export type MemoryWriteEvent = {
  type: "memory.write";
  sessionId?: SessionId;
  key: string;
  value: unknown;
};

export type AgentEvent =
  | RuntimeStartedEvent
  | RuntimeCompletedEvent
  | RuntimeErrorEvent
  | MessageDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | PermissionRequestEvent
  | MemoryWriteEvent;

export function createSessionId(): SessionId {
  const entropy = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

  return `sf_session_${entropy}`;
}

export function isTerminalAgentEvent(event: AgentEvent): boolean {
  return event.type === "runtime.completed" || event.type === "runtime.error";
}
