import { describe, expect, it } from "vitest";

import {
  createSessionId,
  createTurnId,
  isTerminalAgentEvent,
  type AgentEvent,
  type SessionId,
  type TurnId,
} from "./events";
import type { AppSettingsView, CommandExecutionMode, ResponseMode } from "./settings";

const sessionId = "sf_session_test" satisfies SessionId;
const turnId = "sf_turn_test" satisfies TurnId;

const runtimeStartedEvent = {
  type: "runtime.started",
  sessionId,
  turnId,
  createdAt: "2026-06-05T00:00:00.000Z",
} satisfies AgentEvent;

const runtimeCompletedEvent = {
  type: "runtime.completed",
  sessionId,
  turnId,
} satisfies AgentEvent;

const runtimeErrorEvent = {
  type: "runtime.error",
  sessionId,
  turnId,
  message: "The runtime stopped.",
} satisfies AgentEvent;

const messageDeltaEvent = {
  type: "message.delta",
  sessionId,
  turnId,
  content: "hello",
} satisfies AgentEvent;

const liveMessageDeltaEvent = {
  type: "message.delta",
  sessionId,
  turnId,
  content: "hello",
  delivery: "live",
} satisfies AgentEvent;

const responseFallbackEvent = {
  type: "response.fallback",
  sessionId,
  turnId,
  from: "live",
  to: "smooth",
  reason: "stream unavailable",
} satisfies AgentEvent;

const toolCallEvent = {
  type: "tool.call",
  sessionId,
  turnId,
  callId: "call_1",
  name: "read_file",
  input: { path: "README.md" },
} satisfies AgentEvent;

const toolResultEvent = {
  type: "tool.result",
  sessionId,
  turnId,
  callId: "call_1",
  name: "read_file",
  ok: true,
  output: "contents",
} satisfies AgentEvent;

const permissionRequestEvent = {
  type: "permission.request",
  sessionId,
  turnId,
  requestId: "permission_1",
  reason: "Command is outside the safe allowlist.",
  command: {
    program: "agent-browser",
    args: ["screenshot"],
    cwd: "/workspace/project",
  },
  mode: "sentinel",
  risk: "unknown",
} satisfies AgentEvent;

const memoryWriteEvent = {
  type: "memory.write",
  sessionId,
  turnId,
  key: "preference",
  value: "Use pnpm.",
} satisfies AgentEvent;

const modelRequestEvent = {
  type: "model.request",
  sessionId,
  turnId,
  requestId: "model-request-1",
  providerId: "deepseek",
  model: "deepseek-v4-pro",
  responseMode: "live",
  messages: [
    { role: "system", content: "You are StoryForge." },
    { role: "user", content: "Inspect auth" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_1", name: "workspace.readFile", input: { path: "README.md" } }],
    },
    { role: "tool", content: "contents", name: "workspace.readFile", toolCallId: "call_1" },
  ],
  tools: [
    {
      name: "workspace.readFile",
      description: "Read a file",
      parameters: { type: "object" },
    },
  ],
} satisfies AgentEvent;

const agentEventFixtures = [
  runtimeStartedEvent,
  runtimeCompletedEvent,
  runtimeErrorEvent,
  messageDeltaEvent,
  liveMessageDeltaEvent,
  responseFallbackEvent,
  toolCallEvent,
  toolResultEvent,
  permissionRequestEvent,
  memoryWriteEvent,
  modelRequestEvent,
] satisfies AgentEvent[];

describe("createSessionId", () => {
  it("returns a StoryForge session id", () => {
    expect(createSessionId()).toMatch(/^sf_session_[a-z0-9]+$/);
  });
});

describe("createTurnId", () => {
  it("returns a StoryForge turn id", () => {
    expect(createTurnId()).toMatch(/^sf_turn_[a-z0-9]+$/);
  });
});

describe("settings types", () => {
  it("accepts the three global response modes", () => {
    const modes: ResponseMode[] = ["auto", "live", "smooth"];

    expect(modes).toEqual(["auto", "live", "smooth"]);
  });

  it("accepts the developer mode default shape", () => {
    const settings = {
      schemaVersion: 1,
      responseMode: "auto",
      developerMode: false,
      commandExecutionMode: "sentinel",
    } satisfies AppSettingsView;

    expect(settings.developerMode).toBe(false);
  });

  it("accepts the three command execution modes", () => {
    const modes: CommandExecutionMode[] = ["sentinel", "cruise", "unleashed"];

    expect(modes).toEqual(["sentinel", "cruise", "unleashed"]);
  });
});

describe("AgentEvent", () => {
  it("allows delivery metadata and fallback notices without marking them terminal", () => {
    expect(liveMessageDeltaEvent.delivery).toBe("live");
    expect(responseFallbackEvent.to).toBe("smooth");
    expect(isTerminalAgentEvent(liveMessageDeltaEvent)).toBe(false);
    expect(isTerminalAgentEvent(responseFallbackEvent)).toBe(false);
  });

  it("allows model request inspection events without marking them terminal", () => {
    expect(modelRequestEvent.messages[0]).toMatchObject({ role: "system" });
    expect(isTerminalAgentEvent(modelRequestEvent)).toBe(false);
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
