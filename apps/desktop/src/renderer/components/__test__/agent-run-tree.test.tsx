import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AgentRunView } from "@story-forge/shared";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRunTree } from "../agent-run-tree";

afterEach(cleanup);

describe("AgentRunTree", () => {
  it("renders the execution hierarchy, live tools, usage, report, and errors", () => {
    render(
      <AgentRunTree
        childActivities={{
          sf_agent_execution_explorer: [
            childEvent({
              type: "tool.call",
              callId: "call-read",
              name: "read",
              input: { path: "README.md" },
            }),
            childEvent({
              type: "tool.call",
              callId: "call-grep",
              name: "grep",
              input: { pattern: "Agent" },
            }),
          ],
        }}
        run={sampleRun()}
      />,
    );

    expect(screen.getByRole("region", { name: "Agent run tree" })).toBeInTheDocument();
    expect(screen.getByText("3 agents")).toBeInTheDocument();
    const explorer = screen.getByRole("article", {
      name: "Explorer agent: Map the orchestration files",
    });
    expect(within(explorer).getByText("Completed")).toBeInTheDocument();
    expect(within(explorer).getByText("00:05")).toBeInTheDocument();
    expect(within(explorer).getByText("2 tools")).toBeInTheDocument();
    expect(within(explorer).getByText("1,500 tokens · $0.0123")).toBeInTheDocument();

    fireEvent.click(within(explorer).getByText("Result"));
    expect(within(explorer).getByText("Found the coordinator boundary.")).toBeInTheDocument();
    expect(within(explorer).getByText("Coordinator owns sequencing.")).toBeInTheDocument();

    const reviewer = screen.getByRole("article", {
      name: "Reviewer agent: Review the cancellation path",
    });
    expect(within(reviewer).getByText("Failed")).toBeInTheDocument();
    expect(within(reviewer).getByText("Child timed out")).toBeInTheDocument();
  });
});

function sampleRun(): AgentRunView {
  const emptyUsage = {
    turns: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
  return {
    schemaVersion: 1,
    sessionId: "sf_session_team",
    turnId: "sf_turn_team",
    rootExecutionId: "sf_agent_execution_root",
    sequence: 8,
    createdAt: "2026-08-28T08:00:00.000Z",
    updatedAt: "2026-08-28T08:00:06.000Z",
    executions: [
      {
        id: "sf_agent_execution_root",
        role: "root",
        objective: "Answer the user",
        status: "running",
        attempt: 1,
        providerId: "openai",
        model: "gpt-test",
        createdAt: "2026-08-28T08:00:00.000Z",
        startedAt: "2026-08-28T08:00:00.000Z",
        usage: emptyUsage,
      },
      {
        id: "sf_agent_execution_explorer",
        parentExecutionId: "sf_agent_execution_root",
        role: "explorer",
        objective: "Map the orchestration files",
        status: "completed",
        attempt: 1,
        providerId: "openai",
        model: "gpt-test",
        createdAt: "2026-08-28T08:00:00.000Z",
        startedAt: "2026-08-28T08:00:01.000Z",
        endedAt: "2026-08-28T08:00:06.000Z",
        usage: {
          ...emptyUsage,
          turns: 2,
          toolCalls: 1,
          inputTokens: 1_200,
          outputTokens: 300,
          costUsd: 0.0123,
        },
        report: {
          summary: "Found the coordinator boundary.",
          findings: ["Coordinator owns sequencing."],
          evidence: [],
          filesInspected: ["packages/agent/src/runtime/agent-coordinator.ts"],
          unresolved: [],
        },
      },
      {
        id: "sf_agent_execution_reviewer",
        parentExecutionId: "sf_agent_execution_root",
        role: "reviewer",
        objective: "Review the cancellation path",
        status: "failed",
        attempt: 1,
        providerId: "openai",
        model: "gpt-test",
        createdAt: "2026-08-28T08:00:00.000Z",
        startedAt: "2026-08-28T08:00:01.000Z",
        endedAt: "2026-08-28T08:00:04.000Z",
        usage: emptyUsage,
        error: "Child timed out",
      },
    ],
  };
}

function childEvent(
  event: {
    type: "tool.call";
    callId: string;
    name: string;
    input: unknown;
  },
) {
  return {
    ...event,
    eventId: `sf_agent_event_${event.callId}` as const,
    sequence: 4,
    occurredAt: "2026-08-28T08:00:02.000Z",
    sessionId: "sf_session_team" as const,
    turnId: "sf_turn_team" as const,
    agentExecutionId: "sf_agent_execution_explorer" as const,
    parentAgentExecutionId: "sf_agent_execution_root" as const,
  };
}
