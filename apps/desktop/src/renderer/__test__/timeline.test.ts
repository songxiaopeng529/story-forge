// @vitest-environment node

import type { HumanInputRequestEvent, UnsequencedAgentEvent } from "@story-forge/shared";
import { describe, expect, it } from "vitest";
import type { PersistedMessageView, SessionView } from "../../shared/story-forge-api";
import { buildTimeline } from "../utils/timeline";

const userMessage: PersistedMessageView = {
  id: "message-user",
  role: "user",
  content: "Inspect",
  createdAt: "2026-06-19T00:00:00.000Z",
};

const baseSession: SessionView = {
  schemaVersion: 2,
  id: "sf_session_test",
  workspaceId: "workspace",
  title: "Timeline",
  providerId: "deepseek",
  model: "deepseek-v4-pro",
  status: "running",
  createdAt: "2026-06-19T00:00:00.000Z",
  updatedAt: "2026-06-19T00:00:00.000Z",
  messages: [userMessage],
  tasks: [],
};

describe("buildTimeline", () => {
  it("renders a persisted provider failure as an error with its original message", () => {
    const items = buildTimeline({
      session: {
        ...baseSession,
        status: "error",
        stopReason: "unrecoverable-error",
        messages: [
          userMessage,
          {
            id: "message-error",
            role: "assistant",
            content: "400 invalid tool name",
            error: true,
            createdAt: "2026-08-03T00:00:00.000Z",
          },
        ],
      },
      activities: [],
      activeTurnId: undefined,
    });

    expect(items).toContainEqual({
      type: "error",
      id: "message-error",
      message: "400 invalid tool name",
    });
    expect(items.filter((item) => item.type === "error")).toHaveLength(1);
  });

  it("keeps active tool steps before later assistant deltas", () => {
    const activities: UnsequencedAgentEvent[] = [
      {
        type: "tool.call",
        sessionId: "sf_session_test",
        turnId: "sf_turn_active",
        callId: "call_cmd",
        name: "workspace.runCommand",
        input: { command: "pnpm test" },
      },
      {
        type: "tool.result",
        sessionId: "sf_session_test",
        turnId: "sf_turn_active",
        callId: "call_cmd",
        name: "workspace.runCommand",
        ok: false,
        output: "failed",
      },
      {
        type: "message.delta",
        sessionId: "sf_session_test",
        turnId: "sf_turn_active",
        content: "I found the failing command.",
        delivery: "live",
      },
    ];

    expect(buildTimeline({
      session: baseSession,
      activities,
      activeTurnId: "sf_turn_active",
    }).map((item) => item.type)).toEqual([
      "user-message",
      "tool-step",
      "assistant-message",
    ]);
  });

  it("merges tool call and result into one active tool step", () => {
    const items = buildTimeline({
      session: baseSession,
      activeTurnId: "sf_turn_active",
      activities: [
        {
          type: "tool.call",
          sessionId: "sf_session_test",
          turnId: "sf_turn_active",
          callId: "call_read",
          name: "workspace.readFile",
          input: { path: "README.md" },
        },
        {
          type: "tool.result",
          sessionId: "sf_session_test",
          turnId: "sf_turn_active",
          callId: "call_read",
          name: "workspace.readFile",
          ok: true,
          output: "README",
        },
      ],
    });

    const toolSteps = items.filter((item) => item.type === "tool-step");
    expect(toolSteps).toHaveLength(1);
    expect(toolSteps[0]).toMatchObject({
      callId: "call_read",
      name: "workspace.readFile",
      status: "completed",
      input: { path: "README.md" },
      output: "README",
    });
  });

  it("collapses a live agent_delegate call and result into one summary card", () => {
    const items = buildTimeline({
      session: baseSession,
      activeTurnId: "sf_turn_active",
      activities: [
        {
          type: "tool.call",
          sessionId: "sf_session_test",
          turnId: "sf_turn_active",
          callId: "call_delegate",
          name: "agent_delegate",
          input: {
            tasks: [
              { role: "explorer", objective: "Map the runtime" },
              { role: "reviewer", objective: "Review cancellation" },
            ],
          },
        },
        {
          type: "tool.result",
          sessionId: "sf_session_test",
          turnId: "sf_turn_active",
          callId: "call_delegate",
          name: "agent_delegate",
          ok: true,
          output: {
            status: "partial",
            results: [
              { status: "completed" },
              { status: "failed" },
            ],
          },
        },
      ],
    });

    expect(items.filter((item) => item.type === "delegate-summary")).toEqual([{
      type: "delegate-summary",
      id: "delegate-sf_turn_active-call_delegate",
      callId: "call_delegate",
      status: "completed",
      taskCount: 2,
      objectives: ["Map the runtime", "Review cancellation"],
      resultStatus: "partial",
      completedCount: 1,
      failedCount: 1,
      cancelledCount: 0,
    }]);
    expect(items.some((item) => item.type === "tool-step" && item.name === "agent_delegate"))
      .toBe(false);
  });

  it("renders a persisted agent_delegate result as one summary card", () => {
    const items = buildTimeline({
      session: {
        ...baseSession,
        status: "completed",
        messages: [
          {
            id: "assistant-delegate",
            role: "assistant",
            content: "",
            toolCalls: [{
              id: "call_delegate",
              name: "agent_delegate",
              input: { tasks: [{ role: "explorer", objective: "Inspect persistence" }] },
            }],
            createdAt: "2026-08-28T08:00:00.000Z",
          },
          {
            id: "tool-delegate",
            role: "tool",
            content: JSON.stringify({
              status: "completed",
              results: [{ status: "completed" }],
            }),
            name: "agent_delegate",
            toolCallId: "call_delegate",
            ok: true,
            createdAt: "2026-08-28T08:00:01.000Z",
          },
        ],
      },
      activities: [],
      activeTurnId: undefined,
    });

    expect(items).toEqual([expect.objectContaining({
      type: "delegate-summary",
      taskCount: 1,
      objectives: ["Inspect persistence"],
      resultStatus: "completed",
      completedCount: 1,
    })]);
  });

  it("renders a result-only active tool step when the call event is missing", () => {
    const items = buildTimeline({
      session: baseSession,
      activeTurnId: "sf_turn_active",
      activities: [
        {
          type: "tool.result",
          sessionId: "sf_session_test",
          turnId: "sf_turn_active",
          callId: "call_missing",
          name: "workspace.readFile",
          ok: false,
          output: "missing call event",
        },
      ],
    });

    expect(items).toContainEqual(expect.objectContaining({
      type: "tool-step",
      callId: "call_missing",
      status: "failed",
      output: "missing call event",
    }));
  });

  it("splits persisted assistant reasoning, tool results, and final answer", () => {
    const completedSession: SessionView = {
      ...baseSession,
      status: "completed",
      messages: [
        userMessage,
        {
          id: "assistant-tools",
          role: "assistant",
          content: "",
          reasoningContent: "I should inspect the file.",
          toolCalls: [{
            id: "call_read",
            name: "workspace.readFile",
            input: { path: "README.md" },
          }],
          createdAt: "2026-06-19T00:00:01.000Z",
        },
        {
          id: "tool-read",
          role: "tool",
          content: "README",
          name: "workspace.readFile",
          toolCallId: "call_read",
          ok: true,
          createdAt: "2026-06-19T00:00:02.000Z",
        },
        {
          id: "assistant-final",
          role: "assistant",
          content: "Done.",
          createdAt: "2026-06-19T00:00:03.000Z",
        },
      ],
    };

    const items = buildTimeline({
      session: completedSession,
      activities: [],
      activeTurnId: undefined,
    });

    expect(items.map((item) => item.type)).toEqual([
      "user-message",
      "reasoning",
      "tool-step",
      "assistant-message",
    ]);
    expect(items.filter((item) => item.type === "tool-step")).toEqual([
      expect.objectContaining({
        callId: "call_read",
        input: { path: "README.md" },
        output: "README",
      }),
    ]);
  });

  it("skips empty persisted assistant messages", () => {
    const items = buildTimeline({
      session: {
        ...baseSession,
        messages: [
          userMessage,
          {
            id: "empty-assistant",
            role: "assistant",
            content: "   ",
            createdAt: "2026-06-19T00:00:01.000Z",
          },
        ],
      },
      activities: [],
      activeTurnId: undefined,
    });

    expect(items.map((item) => item.type)).toEqual(["user-message"]);
  });

  it("keeps automation proposals as durable timeline items", () => {
    const items = buildTimeline({
      session: baseSession,
      activities: [],
      activeTurnId: undefined,
      automationProposals: [{
        proposalId: "automation-proposal-1",
        status: "pending",
        proposal: {
          kind: "scheduled_chat",
          name: "Daily risk audit",
          scheduleText: "每天早上 9 点",
          cron: "0 9 * * *",
          timezone: "Asia/Shanghai",
          summary: "Every day at 09:00",
          nextRuns: ["2026-06-20T01:00:00.000Z"],
          prompt: "Review repository risk.",
          workspaceId: "workspace",
          providerId: "deepseek",
          model: "deepseek-v4-pro",
        },
      }],
    });

    expect(items).toContainEqual(expect.objectContaining({
      type: "automation-proposal",
      proposalId: "automation-proposal-1",
      status: "pending",
    }));
  });

  it("renders a pending human input request as a timeline item", () => {
    const humanInputRequest = {
      eventId: "sf_agent_event_human_input",
      sequence: 1,
      occurredAt: "2026-08-28T08:00:00.000Z",
      agentExecutionId: "sf_agent_execution_root",
      type: "human.input.request",
      sessionId: "sf_session_test",
      turnId: "sf_turn_active",
      requestId: "human_input_1",
      title: "Choose implementation scope",
      questions: [
        {
          id: "scope",
          header: "Scope",
          question: "Which scope?",
          type: "single_select",
          options: [
            { id: "minimal", label: "Minimal" },
            { id: "full", label: "Full" },
          ],
        },
      ],
    } satisfies HumanInputRequestEvent;
    const items = buildTimeline({
      session: baseSession,
      activities: [],
      activeTurnId: "sf_turn_active",
      humanInputRequest,
      humanInputResponding: true,
    });

    expect(items).toContainEqual(expect.objectContaining({
      type: "human-input",
      id: "human-input-sf_turn_active-human_input_1",
      request: humanInputRequest,
      responding: true,
    }));
    expect(items.some((item) => item.type === "assistant-message" && item.content === "Thinking...")).toBe(false);
  });

  it("hides ask_user tool steps from the timeline", () => {
    const items = buildTimeline({
      session: baseSession,
      activeTurnId: "sf_turn_active",
      activities: [
        {
          type: "tool.call",
          sessionId: "sf_session_test",
          turnId: "sf_turn_active",
          callId: "call_human",
          name: "ask_user",
          input: { title: "Choose" },
        },
        {
          type: "tool.result",
          sessionId: "sf_session_test",
          turnId: "sf_turn_active",
          callId: "call_human",
          name: "ask_user",
          ok: true,
          output: { answers: [] },
        },
      ],
    });

    expect(items.some((item) => item.type === "tool-step" && item.name === "ask_user")).toBe(false);
  });

  it("adds a consolidated task list from persisted session tasks", () => {
    const items = buildTimeline({
      session: {
        ...baseSession,
        tasks: [
          {
            id: "sf_task_1",
            title: "Inspect runtime",
            status: "completed",
            createdAt: "2026-06-23T00:00:00.000Z",
            updatedAt: "2026-06-23T00:00:00.000Z",
          },
          {
            id: "sf_task_2",
            title: "Wire UI",
            status: "in_progress",
            activeForm: "Rendering tasks",
            createdAt: "2026-06-23T00:00:00.000Z",
            updatedAt: "2026-06-23T00:00:00.000Z",
          },
        ],
      },
      activities: [],
      activeTurnId: undefined,
    });

    expect(items).toContainEqual(expect.objectContaining({
      type: "task-list",
      completedCount: 1,
      totalCount: 2,
      tasks: [
        expect.objectContaining({ title: "Inspect runtime", status: "completed" }),
        expect.objectContaining({ title: "Wire UI", status: "in_progress" }),
      ],
    }));
  });

  it("renders a persisted summary message as a summary item", () => {
    const items = buildTimeline({
      session: {
        ...baseSession,
        status: "completed",
        messages: [
          {
            id: "summary-1",
            role: "assistant",
            content: "结构化摘要内容",
            kind: "summary",
            createdAt: "2026-06-19T00:00:01.000Z",
          },
          userMessage,
        ],
      },
      activities: [],
      activeTurnId: undefined,
    });

    expect(items).toContainEqual(expect.objectContaining({
      type: "summary",
      content: "结构化摘要内容",
    }));
  });

  it("renders a completed PI plan as a plan instead of a tool step", () => {
    const items = buildTimeline({
      session: {
        ...baseSession,
        status: "completed",
        messages: [{
          id: "plan-result",
          role: "tool",
          content: "**Proposed Plan**\n\n1. Inspect the runtime\n2. Implement the bridge",
          name: "plan_mode_complete",
          toolCallId: "call-plan",
          ok: true,
          createdAt: "2026-06-19T00:00:01.000Z",
        }],
      },
      activities: [],
      activeTurnId: undefined,
    });

    expect(items).toEqual([{
      type: "plan",
      id: "plan-result",
      content: "1. Inspect the runtime\n2. Implement the bridge",
    }]);
  });

  it("renders a manual context.compacted event as a notice", () => {
    const items = buildTimeline({
      session: { ...baseSession, status: "completed" },
      activities: [{
        type: "context.compacted",
        sessionId: "sf_session_test",
        turnId: "sf_turn_manual",
        trigger: "manual",
        beforeTokens: 9000,
        afterTokens: 3000,
        budgetTokens: 10000,
        retainedRounds: 1,
      }],
      activeTurnId: undefined,
    });

    expect(items).toContainEqual(expect.objectContaining({
      type: "notice",
      message: "已压缩上下文（约 90% → 30%）",
    }));
  });

  it("uses live task events over persisted tasks for the active turn", () => {
    const items = buildTimeline({
      session: {
        ...baseSession,
        tasks: [{
          id: "sf_task_1",
          title: "Inspect runtime",
          status: "pending",
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
        }],
      },
      activeTurnId: "sf_turn_active",
      activities: [{
        type: "task.list.updated",
        sessionId: "sf_session_test",
        turnId: "sf_turn_active",
        reason: "updated",
        changedTaskId: "sf_task_1",
        tasks: [{
          id: "sf_task_1",
          title: "Inspect runtime",
          status: "completed",
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
        }],
      }],
    });

    expect(items).toContainEqual(expect.objectContaining({
      type: "task-list",
      completedCount: 1,
      totalCount: 1,
      tasks: [expect.objectContaining({ status: "completed" })],
    }));
  });
});
