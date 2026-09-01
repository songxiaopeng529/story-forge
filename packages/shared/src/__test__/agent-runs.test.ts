import { describe, expect, it } from "vitest";

import {
  AGENT_EXECUTION_STATUSES,
  AGENT_ROLES,
  CHILD_AGENT_ROLES,
  createAgentEventId,
  createAgentExecutionId,
  createEmptyAgentExecutionUsage,
  isAgentEventId,
  isAgentExecutionId,
  isAgentExecutionStatus,
  isAgentRole,
  isChildAgentRole,
  isTerminalAgentExecutionStatus,
  type AgentRunView,
  type DelegateResult,
  type DelegateTaskInput,
} from "../agent-runs";
import type { SessionId, TurnId } from "../events";

describe("agent run ids", () => {
  it("creates branded execution and event ids", () => {
    const executionId = createAgentExecutionId();
    const eventId = createAgentEventId();

    expect(executionId).toMatch(/^sf_agent_execution_[a-z0-9]+$/);
    expect(eventId).toMatch(/^sf_agent_event_[a-z0-9]+$/);
    expect(isAgentExecutionId(executionId)).toBe(true);
    expect(isAgentEventId(eventId)).toBe(true);
    expect(isAgentExecutionId(eventId)).toBe(false);
    expect(isAgentEventId(executionId)).toBe(false);
  });
});

describe("agent role and status contracts", () => {
  it("freezes the supported roles and lifecycle states", () => {
    expect(AGENT_ROLES).toEqual(["root", "explorer", "reviewer"]);
    expect(CHILD_AGENT_ROLES).toEqual(["explorer", "reviewer"]);
    expect(AGENT_EXECUTION_STATUSES).toEqual([
      "queued",
      "running",
      "completed",
      "failed",
      "cancelled",
      "interrupted",
    ]);
  });

  it("guards roles and statuses at dependency-free trust boundaries", () => {
    expect(isAgentRole("root")).toBe(true);
    expect(isAgentRole("writer")).toBe(false);
    expect(isChildAgentRole("reviewer")).toBe(true);
    expect(isChildAgentRole("root")).toBe(false);
    expect(isAgentExecutionStatus("interrupted")).toBe(true);
    expect(isAgentExecutionStatus("stopped")).toBe(false);
    expect(isTerminalAgentExecutionStatus("completed")).toBe(true);
    expect(isTerminalAgentExecutionStatus("interrupted")).toBe(false);
  });
});

describe("agent run views", () => {
  it("accepts the frozen public view without internal transcript paths", () => {
    const sessionId = "sf_session_test" satisfies SessionId;
    const turnId = "sf_turn_test" satisfies TurnId;
    const rootExecutionId = "sf_agent_execution_root" as const;
    const run = {
      schemaVersion: 1,
      sessionId,
      turnId,
      rootExecutionId,
      sequence: 3,
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:01.000Z",
      executions: [
        {
          id: rootExecutionId,
          role: "root",
          objective: "Answer the user's request",
          status: "running",
          attempt: 1,
          providerId: "anthropic",
          model: "claude-sonnet-4-5",
          createdAt: "2026-08-31T00:00:00.000Z",
          startedAt: "2026-08-31T00:00:00.100Z",
          usage: createEmptyAgentExecutionUsage(),
        },
      ],
    } satisfies AgentRunView;

    expect(run.executions[0]?.role).toBe("root");
    expect(run.executions[0]).not.toHaveProperty("transcriptFile");
  });
});

describe("delegation contracts", () => {
  it("accepts only child roles in model-visible task inputs", () => {
    const tasks = [
      {
        role: "explorer",
        objective: "Map the persistence boundary",
        scope: ["packages/agent/src/persistence"],
      },
      {
        role: "reviewer",
        objective: "Review event ordering",
        constraints: ["read-only"],
        expectedOutput: "Risks with evidence",
      },
    ] satisfies DelegateTaskInput[];

    expect(tasks.map((task) => task.role)).toEqual(["explorer", "reviewer"]);
  });

  it("preserves task result order in the public aggregate", () => {
    const result = {
      status: "partial",
      results: [
        {
          executionId: "sf_agent_execution_first",
          role: "explorer",
          status: "completed",
          report: {
            summary: "Mapped persistence",
            findings: [],
            evidence: [],
            filesInspected: ["packages/agent/src/persistence/session-repository.ts"],
            unresolved: [],
          },
          usage: createEmptyAgentExecutionUsage(),
          truncated: false,
        },
        {
          executionId: "sf_agent_execution_second",
          role: "reviewer",
          status: "failed",
          error: "Child timed out",
          usage: createEmptyAgentExecutionUsage(),
          truncated: false,
        },
      ],
    } satisfies DelegateResult;

    expect(result.results.map(({ executionId }) => executionId)).toEqual([
      "sf_agent_execution_first",
      "sf_agent_execution_second",
    ]);
  });
});
