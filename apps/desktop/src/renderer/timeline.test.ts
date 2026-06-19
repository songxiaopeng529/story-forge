// @vitest-environment node

import type { AgentEvent } from "@story-forge/shared";
import { describe, expect, it } from "vitest";
import type { PersistedMessageView, SessionView } from "../shared/story-forge-api";
import { buildTimeline } from "./timeline";

const userMessage: PersistedMessageView = {
  id: "message-user",
  role: "user",
  content: "Inspect",
  createdAt: "2026-06-19T00:00:00.000Z",
};

const baseSession: SessionView = {
  schemaVersion: 1,
  id: "sf_session_test",
  workspaceId: "workspace",
  title: "Timeline",
  providerId: "deepseek",
  model: "deepseek-v4-pro",
  status: "running",
  createdAt: "2026-06-19T00:00:00.000Z",
  updatedAt: "2026-06-19T00:00:00.000Z",
  messages: [userMessage],
};

describe("buildTimeline", () => {
  it("keeps active tool steps before later assistant deltas", () => {
    const activities: AgentEvent[] = [
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
    expect(items.filter((item) => item.type === "tool-step")).toHaveLength(1);
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
});
