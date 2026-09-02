// @vitest-environment node

import {
  createEmptyAgentExecutionUsage,
  type AgentEvent,
  type DelegateResult,
} from "@story-forge/shared";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentRunRepository, type AgentExecutionRecord } from "../persistence/agent-run-repository";
import type { SessionRepository } from "../persistence/session-repository";
import type { PiModelService } from "../pi/pi-model-service";
import type { PiSessionAdapter } from "../pi/pi-session-adapter";
import type { StoryForgeWorkspaceStore } from "../ports/host";
import { AgentCoordinator } from "../runtime/agent-coordinator";
import type { PiAgentWorker } from "../runtime/pi-agent-worker";

const sessionId = "sf_session_team" as const;
const turnId = "sf_turn_team" as const;
const rootExecutionId = "sf_agent_execution_root" as const;
const now = "2026-08-28T08:00:00.000Z";

describe("AgentCoordinator delegation", () => {
  it("retains partial results and persists terminal state before lifecycle events", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "storyforge-coordinator-"));
    const runs = new AgentRunRepository({ rootDir, now: () => now });
    const root: AgentExecutionRecord = {
      id: rootExecutionId,
      role: "root",
      objective: "Coordinate a review",
      status: "running",
      attempt: 1,
      providerId: "deepseek",
      model: "deepseek-chat",
      createdAt: now,
      startedAt: now,
      usage: createEmptyAgentExecutionUsage(),
    };
    await runs.createRun({
      sessionId,
      workspaceId: "workspace-1",
      turnId,
      rootExecutionId,
      executions: [root],
      createdAt: now,
    });
    const events: AgentEvent[] = [];
    let lateChildEvent: ((event: unknown) => void) | undefined;
    const worker = {
      run: vi.fn(async (input: {
        role: string;
        providerId: string;
        model: string;
        onEvent?: (event: unknown) => void;
      }) => {
        lateChildEvent = input.onEvent;
        input.onEvent?.({
          type: "tool.call",
          callId: `call-${input.role}`,
          name: "read",
          input: { path: "README.md" },
        });
        return input.role === "explorer"
          ? {
              status: "completed" as const,
              report: {
                summary: "Found the runtime entry points.",
                findings: [],
                evidence: [],
                filesInspected: ["README.md"],
                unresolved: [],
              },
              usage: { ...createEmptyAgentExecutionUsage(), turns: 1, toolCalls: 1 },
              truncated: false,
              transcriptFile: join(
                rootDir,
                "sessions/agent-transcripts/workspace-1/sf_turn_team/explorer.jsonl",
              ),
            }
          : {
              status: "failed" as const,
              error: "review failed",
              usage: { ...createEmptyAgentExecutionUsage(), turns: 1, toolCalls: 1 },
              truncated: false,
              transcriptFile: join(
                rootDir,
                "sessions/agent-transcripts/workspace-1/sf_turn_team/reviewer.jsonl",
              ),
            };
      }),
    };
    const coordinator = new AgentCoordinator({
      agentRunRepository: runs,
      sessionRepository: {} as SessionRepository,
      workspaceRepository: {} as StoryForgeWorkspaceStore,
      piModels: {} as PiModelService,
      piSessions: {} as PiSessionAdapter,
      childWorker: worker as unknown as PiAgentWorker,
      now: () => new Date(now),
      emit: (event) => events.push(event),
    });
    const activeRuns = (coordinator as unknown as {
      activeRuns: Map<string, unknown>;
    }).activeRuns;
    activeRuns.set(turnId, {
      sessionId,
      workspaceId: "workspace-1",
      turnId,
      rootExecutionId,
      providerId: "deepseek",
      model: "deepseek-chat",
      sequence: 0,
      eventTail: Promise.resolve(),
      childControllers: new Map(),
      childPromises: new Set(),
      activeChildExecutions: new Set(),
      rootCapacityReleased: false,
      rootTerminal: false,
    });
    const delegate = (coordinator as unknown as {
      delegate(input: {
        sessionId: typeof sessionId;
        turnId: typeof turnId;
        input: { tasks: Array<{ role: "explorer" | "reviewer"; objective: string }> };
        signal: AbortSignal;
      }): Promise<DelegateResult>;
    }).delegate.bind(coordinator);

    const result = await delegate({
      sessionId,
      turnId,
      input: {
        tasks: [
          { role: "explorer", objective: "Map runtime entry points" },
          { role: "reviewer", objective: "Review cancellation" },
        ],
      },
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("partial");
    expect(result.results.map(({ status }) => status)).toEqual(["completed", "failed"]);
    expect(worker.run.mock.calls.map(([input]) => [input.providerId, input.model])).toEqual([
      ["deepseek", "deepseek-chat"],
      ["deepseek", "deepseek-chat"],
    ]);
    const snapshot = await runs.getRun(turnId);
    expect(snapshot?.executions.slice(1).map(({ status }) => status)).toEqual([
      "completed",
      "failed",
    ]);
    expect(events.filter(({ type }) => type.startsWith("agent.execution.")))
      .toHaveLength(6);
    expect(events.every((event, index) => event.sequence === index + 1)).toBe(true);
    expect(events.every((event) => Boolean(event.eventId && event.occurredAt))).toBe(true);

    const eventCount = events.length;
    lateChildEvent?.({
      type: "message.delta",
      content: "late child output",
      delivery: "live",
    });
    await Promise.resolve();
    expect(events).toHaveLength(eventCount);
  });
});
