import { describe, expect, it } from "vitest";

import {
  createSessionId,
  createTurnId,
  hasAgentEventEnvelope,
  isTerminalAgentEvent,
  type AgentEvent,
  type AgentEventEnvelope,
  type HumanInputResponse,
  type SessionId,
  type TurnId,
} from "../events";
import type { AutomationView, CreateAutomationInput } from "../extensions";
import {
  type AppSettingsView,
  type CommandExecutionMode,
} from "../settings";

const sessionId = "sf_session_test" satisfies SessionId;
const turnId = "sf_turn_test" satisfies TurnId;
const rootEnvelope = {
  eventId: "sf_agent_event_test",
  sequence: 1,
  occurredAt: "2026-06-05T00:00:00.000Z",
  sessionId,
  turnId,
  agentExecutionId: "sf_agent_execution_root",
} satisfies AgentEventEnvelope;

const runtimeStartedEvent = {
  ...rootEnvelope,
  type: "runtime.started",
  createdAt: "2026-06-05T00:00:00.000Z",
} satisfies AgentEvent;

const runtimeCompletedEvent = {
  ...rootEnvelope,
  type: "runtime.completed",
} satisfies AgentEvent;

const runtimeErrorEvent = {
  ...rootEnvelope,
  type: "runtime.error",
  message: "The runtime stopped.",
} satisfies AgentEvent;

const messageDeltaEvent = {
  ...rootEnvelope,
  type: "message.delta",
  content: "hello",
} satisfies AgentEvent;

const liveMessageDeltaEvent = {
  ...rootEnvelope,
  type: "message.delta",
  content: "hello",
  delivery: "live",
} satisfies AgentEvent;

const responseFallbackEvent = {
  ...rootEnvelope,
  type: "response.fallback",
  from: "live",
  to: "smooth",
  reason: "stream unavailable",
} satisfies AgentEvent;

const toolCallEvent = {
  ...rootEnvelope,
  type: "tool.call",
  callId: "call_1",
  name: "read_file",
  input: { path: "README.md" },
} satisfies AgentEvent;

const toolResultEvent = {
  ...rootEnvelope,
  type: "tool.result",
  callId: "call_1",
  name: "read_file",
  ok: true,
  output: "contents",
} satisfies AgentEvent;

const permissionRequestEvent = {
  ...rootEnvelope,
  type: "permission.request",
  requestId: "permission_1",
  reason: "This command can run arbitrary code, inspect secrets, or access remote systems.",
  command: {
    program: "node",
    args: ["-e", "console.log(process.env)"],
    cwd: "/workspace/project",
  },
  mode: "sentinel",
  risk: "high",
} satisfies AgentEvent;

const humanInputRequestEvent = {
  ...rootEnvelope,
  type: "human.input.request",
  requestId: "human-input-1",
  title: "Choose implementation scope",
  description: "StoryForge needs your preference before editing files.",
  questions: [
    {
      id: "scope",
      header: "Scope",
      question: "Which implementation scope should StoryForge use?",
      type: "single_select",
      options: [
        { id: "minimal", label: "Minimal", description: "Touch only the requested files." },
        { id: "full", label: "Full", description: "Include the full UI flow." },
      ],
      required: true,
    },
    {
      id: "targets",
      header: "Targets",
      question: "Which targets should be included?",
      type: "multi_select",
      options: [
        { id: "types", label: "Types" },
        { id: "tests", label: "Tests" },
      ],
    },
  ],
  remark: {
    enabled: true,
    label: "Additional context",
    placeholder: "Optional constraints",
  },
} satisfies AgentEvent;

const humanInputResponse = {
  requestId: "human-input-1",
  answers: [
    {
      id: "scope",
      header: "Scope",
      question: "Which implementation scope should StoryForge use?",
      type: "single_select",
      selectedOptionIds: ["minimal"],
      selectedLabels: ["Minimal"],
    },
  ],
  remark: "Keep it narrow.",
} satisfies HumanInputResponse;

const modelRequestEvent = {
  ...rootEnvelope,
  type: "model.request",
  requestId: "model-request-1",
  providerId: "deepseek",
  model: "deepseek-v4-pro",
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

const contextUsageEvent = {
  ...rootEnvelope,
  type: "context.usage",
  usedTokens: 24000,
  budgetTokens: 102400,
  windowTokens: 128000,
  source: "provider",
} satisfies AgentEvent;

const contextCompactedEvent = {
  ...rootEnvelope,
  type: "context.compacted",
  trigger: "manual",
  beforeTokens: 96000,
  afterTokens: 40000,
  budgetTokens: 102400,
  retainedRounds: 1,
} satisfies AgentEvent;

const automationProposalEvent = {
  ...rootEnvelope,
  type: "automation.proposal",
  proposalId: "automation-proposal-1",
  proposal: {
    kind: "scheduled_chat",
    name: "Daily dependency risk check",
    workspaceId: "workspace-1",
    providerId: "deepseek",
    model: "deepseek-v4-pro",
    scheduleText: "每天上午 9 点",
    cron: "0 9 * * *",
    timezone: "Asia/Shanghai",
    summary: "Every day at 09:00",
    nextRuns: ["2026-06-20T01:00:00.000Z"],
    prompt: "检查当前项目的依赖风险。",
  },
} satisfies AgentEvent;

const childRuntimeCompletedEvent = {
  ...rootEnvelope,
  eventId: "sf_agent_event_child_runtime_completed",
  sequence: 2,
  agentExecutionId: "sf_agent_execution_child",
  parentAgentExecutionId: rootEnvelope.agentExecutionId,
  type: "runtime.completed",
} satisfies AgentEvent;

const executionQueuedEvent = {
  ...rootEnvelope,
  eventId: "sf_agent_event_child_queued",
  sequence: 3,
  agentExecutionId: "sf_agent_execution_child",
  parentAgentExecutionId: rootEnvelope.agentExecutionId,
  type: "agent.execution.queued",
  role: "explorer",
  objective: "Inspect the event pipeline",
} satisfies AgentEvent;

const executionStartedEvent = {
  ...rootEnvelope,
  eventId: "sf_agent_event_child_started",
  sequence: 4,
  agentExecutionId: "sf_agent_execution_child",
  parentAgentExecutionId: rootEnvelope.agentExecutionId,
  type: "agent.execution.started",
} satisfies AgentEvent;

const executionCompletedEvent = {
  ...rootEnvelope,
  eventId: "sf_agent_event_child_completed",
  sequence: 5,
  agentExecutionId: "sf_agent_execution_child",
  parentAgentExecutionId: rootEnvelope.agentExecutionId,
  type: "agent.execution.completed",
  usage: {
    turns: 1,
    toolCalls: 2,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.01,
  },
  report: {
    summary: "The event pipeline is attributed.",
    findings: [],
    evidence: [],
    filesInspected: ["packages/shared/src/events.ts"],
    unresolved: [],
  },
  truncated: false,
} satisfies AgentEvent;

const executionFailedEvent = {
  ...rootEnvelope,
  eventId: "sf_agent_event_child_failed",
  sequence: 6,
  agentExecutionId: "sf_agent_execution_child",
  parentAgentExecutionId: rootEnvelope.agentExecutionId,
  type: "agent.execution.failed",
  usage: executionCompletedEvent.usage,
  error: "Child failed",
} satisfies AgentEvent;

const executionCancelledEvent = {
  ...rootEnvelope,
  eventId: "sf_agent_event_child_cancelled",
  sequence: 7,
  agentExecutionId: "sf_agent_execution_child",
  parentAgentExecutionId: rootEnvelope.agentExecutionId,
  type: "agent.execution.cancelled",
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
  humanInputRequestEvent,
  modelRequestEvent,
  contextUsageEvent,
  contextCompactedEvent,
  automationProposalEvent,
  executionQueuedEvent,
  executionStartedEvent,
  executionCompletedEvent,
  executionFailedEvent,
  executionCancelledEvent,
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
  it("accepts the developer mode default shape", () => {
    const settings = {
      schemaVersion: 1,
      language: "en",
      developerMode: false,
      commandExecutionMode: "sentinel",
      webAccessEnabled: false,
      webSearchCoverage: "focused",
      soulMode: "ask",
    } satisfies AppSettingsView;

    expect(settings.developerMode).toBe(false);
    expect(settings.soulMode).toBe("ask");
  });

  it("accepts the three command execution modes", () => {
    const modes: CommandExecutionMode[] = ["sentinel", "cruise", "unleashed"];

    expect(modes).toEqual(["sentinel", "cruise", "unleashed"]);
  });

  it("accepts automation view and create input shapes", () => {
    const automation = {
      schemaVersion: 1,
      id: "sf_automation_daily",
      kind: "scheduled_chat",
      name: "Daily check",
      status: "active",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      schedule: {
        sourceText: "daily at 9",
        cron: "0 9 * * *",
        timezone: "Asia/Shanghai",
        summary: "Every day at 09:00",
      },
      prompt: "Check dependency risk.",
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    } satisfies AutomationView;
    const input = {
      name: automation.name,
      status: automation.status,
      workspaceId: automation.workspaceId,
      providerId: automation.providerId,
      model: automation.model,
      schedule: automation.schedule,
      prompt: automation.prompt,
    } satisfies CreateAutomationInput;

    expect(input.schedule.cron).toBe("0 9 * * *");
  });

  it("accepts thread timer automation shapes", () => {
    const automation = {
      schemaVersion: 1,
      id: "sf_automation_thread",
      kind: "thread_chat",
      name: "Build monitor",
      status: "active",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      sessionId: "sf_session_existing",
      schedule: {
        sourceText: "every hour",
        cron: "0 * * * *",
        timezone: "UTC",
        summary: "Every hour",
      },
      prompt: "Check build status in this session.",
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    } satisfies AutomationView;
    const input = {
      kind: automation.kind,
      name: automation.name,
      status: automation.status,
      workspaceId: automation.workspaceId,
      providerId: automation.providerId,
      model: automation.model,
      sessionId: automation.sessionId,
      schedule: automation.schedule,
      prompt: automation.prompt,
    } satisfies CreateAutomationInput;

    expect(input.kind).toBe("thread_chat");
    expect(input.sessionId).toBe("sf_session_existing");
  });
});

describe("AgentEvent", () => {
  it("carries execution attribution on every event variant", () => {
    for (const event of agentEventFixtures) {
      expect(hasAgentEventEnvelope(event)).toBe(true);
      expect(event.eventId).toMatch(/^sf_agent_event_/);
      expect(event.sequence).toBeGreaterThan(0);
      expect(event.occurredAt).toBe(rootEnvelope.occurredAt);
      expect(event.agentExecutionId).toMatch(/^sf_agent_execution_/);
    }
  });

  it("accepts the child execution lifecycle variants", () => {
    expect(executionQueuedEvent.role).toBe("explorer");
    expect(executionCompletedEvent.report.summary).toContain("attributed");
    expect(executionFailedEvent.error).toBe("Child failed");
    expect(executionCancelledEvent.parentAgentExecutionId).toBe(
      rootEnvelope.agentExecutionId,
    );
  });

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

  it("allows automation proposal events without marking them terminal", () => {
    expect(automationProposalEvent.proposal.cron).toBe("0 9 * * *");
    expect(automationProposalEvent.proposal.kind).toBe("scheduled_chat");
    expect(isTerminalAgentEvent(automationProposalEvent)).toBe(false);
  });

  it("allows human input request events and responses without marking them terminal", () => {
    expect(humanInputRequestEvent.questions[0]?.type).toBe("single_select");
    expect(humanInputResponse.answers?.[0]?.selectedOptionIds).toEqual(["minimal"]);
    expect(isTerminalAgentEvent(humanInputRequestEvent)).toBe(false);
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

  it("does not treat child runtime or child lifecycle events as root terminal events", () => {
    expect(isTerminalAgentEvent(childRuntimeCompletedEvent)).toBe(false);
    expect(isTerminalAgentEvent(executionCompletedEvent)).toBe(false);
    expect(isTerminalAgentEvent(executionFailedEvent)).toBe(false);
  });

  it("narrows terminal runtime events", () => {
    const terminalEvents = agentEventFixtures.filter(isTerminalAgentEvent);

    expect(terminalEvents.map((event) => event.type)).toEqual([
      "runtime.completed",
      "runtime.error",
    ]);
  });
});
