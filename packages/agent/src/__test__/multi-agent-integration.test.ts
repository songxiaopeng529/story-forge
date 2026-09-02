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
import type { PiAgentWorker, PiAgentWorkerResult } from "../runtime/pi-agent-worker";

const sessionId = "sf_session_integration" as const;
const turnId = "sf_turn_integration" as const;
const rootExecutionId = "sf_agent_execution_integrationroot" as const;
const now = "2026-08-28T08:00:00.000Z";

describe("multi-agent V1 integration", () => {
  it("limits one Turn to two live children, preserves result order, and recovers the root", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "storyforge-multi-agent-"));
    const runs = new AgentRunRepository({ rootDir, now: () => now });
    const root: AgentExecutionRecord = {
      id: rootExecutionId,
      role: "root",
      objective: "Coordinate three independent inspections",
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
      workspaceId: "workspace-integration",
      turnId,
      rootExecutionId,
      executions: [root],
      createdAt: now,
    });

    let activeChildren = 0;
    let peakChildren = 0;
    const releases: Array<() => void> = [];
    const worker = {
      run: vi.fn((input: { task: { objective: string }; signal: AbortSignal }) => {
        activeChildren += 1;
        peakChildren = Math.max(peakChildren, activeChildren);
        return new Promise<PiAgentWorkerResult>((resolve) => {
          let settled = false;
          const finish = (result: PiAgentWorkerResult) => {
            if (settled) {
              return;
            }
            settled = true;
            activeChildren -= 1;
            resolve(result);
          };
          input.signal.addEventListener("abort", () => finish({
            status: "cancelled",
            usage: createEmptyAgentExecutionUsage(),
            truncated: false,
            transcriptFile: "",
          }), { once: true });
          releases.push(() => finish({
              status: "completed",
              report: {
                summary: input.task.objective,
                findings: [],
                evidence: [],
                filesInspected: [],
                unresolved: [],
              },
              usage: { ...createEmptyAgentExecutionUsage(), turns: 1 },
              truncated: false,
              transcriptFile: join(
                rootDir,
                "sessions/agent-transcripts/workspace-integration/sf_turn_integration",
                `${releases.length}.jsonl`,
              ),
            }));
        });
      }),
    };
    const events: AgentEvent[] = [];
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
    (coordinator as unknown as { activeRuns: Map<string, unknown> }).activeRuns.set(turnId, {
      sessionId,
      workspaceId: "workspace-integration",
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
        input: {
          tasks: Array<{ role: "explorer" | "reviewer"; objective: string }>;
        };
        signal: AbortSignal;
      }): Promise<DelegateResult>;
    }).delegate.bind(coordinator);

    const resultPromise = delegate({
      sessionId,
      turnId,
      input: {
        tasks: [
          { role: "explorer", objective: "first" },
          { role: "reviewer", objective: "second" },
          { role: "explorer", objective: "third" },
        ],
      },
      signal: new AbortController().signal,
    });

    await vi.waitFor(() => expect(worker.run).toHaveBeenCalledTimes(2));
    expect(peakChildren).toBe(2);
    releases[1]!();
    await vi.waitFor(() => expect(worker.run).toHaveBeenCalledTimes(3));
    releases[2]!();
    releases[0]!();

    const result = await resultPromise;
    expect(result.status).toBe("completed");
    expect(result.results.map((entry) => entry.report?.summary)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );

    const cancelledPromise = delegate({
      sessionId,
      turnId,
      input: {
        tasks: [
          { role: "explorer", objective: "cancel first" },
          { role: "reviewer", objective: "cancel second" },
          { role: "explorer", objective: "cancel while queued" },
        ],
      },
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(worker.run).toHaveBeenCalledTimes(5));
    await coordinator.stop(turnId);
    const cancelled = await cancelledPromise;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.results.map(({ status }) => status)).toEqual([
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
    expect(worker.run).toHaveBeenCalledTimes(5);

    const restarted = new AgentRunRepository({ rootDir, now: () => now });
    await restarted.recoverInterruptedRuns();
    const recovered = await restarted.getRun(turnId);
    expect(recovered?.executions[0]?.status).toBe("interrupted");
    expect(recovered?.executions.slice(1, 4).map(({ status }) => status)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(recovered?.executions.slice(4).map(({ status }) => status)).toEqual([
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
  });
});
