import { describe, expect, it } from "vitest";

import { createSessionId, isTerminalAgentEvent, type AgentEvent, type SessionId } from "./events";

const sessionId = "sf_session_test" satisfies SessionId;

const runtimeStartedEvent = {
  type: "runtime.started",
  sessionId,
  createdAt: "2026-06-05T00:00:00.000Z",
} satisfies AgentEvent;

const runtimeCompletedEvent = {
  type: "runtime.completed",
  sessionId,
} satisfies AgentEvent;

const runtimeErrorEvent = {
  type: "runtime.error",
  sessionId,
  message: "The runtime stopped.",
} satisfies AgentEvent;

const messageDeltaEvent = {
  type: "message.delta",
  sessionId,
  content: "hello",
} satisfies AgentEvent;

const toolCallEvent = {
  type: "tool.call",
  sessionId,
  callId: "call_1",
  name: "read_file",
  input: { path: "README.md" },
} satisfies AgentEvent;

const toolResultEvent = {
  type: "tool.result",
  sessionId,
  callId: "call_1",
  name: "read_file",
  ok: true,
  output: "contents",
} satisfies AgentEvent;

const permissionRequestEvent = {
  type: "permission.request",
  sessionId,
  requestId: "permission_1",
  reason: "Need to edit a workspace file.",
} satisfies AgentEvent;

const memoryWriteEvent = {
  type: "memory.write",
  sessionId,
  key: "preference",
  value: "Use pnpm.",
} satisfies AgentEvent;

const agentEventFixtures = [
  runtimeStartedEvent,
  runtimeCompletedEvent,
  runtimeErrorEvent,
  messageDeltaEvent,
  toolCallEvent,
  toolResultEvent,
  permissionRequestEvent,
  memoryWriteEvent,
] satisfies AgentEvent[];

describe("createSessionId", () => {
  it("returns a StoryForge session id", () => {
    expect(createSessionId()).toMatch(/^sf_session_[a-z0-9]+$/);
  });
});

describe("isTerminalAgentEvent", () => {
  it("returns true for terminal runtime events", () => {
    expect(isTerminalAgentEvent(runtimeCompletedEvent)).toBe(true);
    expect(isTerminalAgentEvent(runtimeErrorEvent)).toBe(true);
  });

  it("returns false for non-terminal agent events", () => {
    expect(isTerminalAgentEvent(messageDeltaEvent)).toBe(false);
  });

  it("narrows terminal runtime events", () => {
    const terminalEvents = agentEventFixtures.filter(isTerminalAgentEvent);

    expect(terminalEvents.map((event) => event.type)).toEqual([
      "runtime.completed",
      "runtime.error",
    ]);
  });
});
