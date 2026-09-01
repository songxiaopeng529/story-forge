import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { PiModelService } from "../pi/pi-model-service";
import type { PiSessionAdapter } from "../pi/pi-session-adapter";
import type { StoryForgeWorkspaceStore } from "../ports/host";
import { PiAgentWorker } from "../runtime/pi-agent-worker";

describe("PiAgentWorker", () => {
  it("creates an isolated child session and truncates fallback output", async () => {
    const createAgentExecutionSession = vi.fn(async () => ({
      sessionManager: {},
      transcriptFile: "/tmp/child.jsonl",
    }));
    const createAgentSession = vi.fn(async () => ({
      messages: [{ role: "assistant", content: "x".repeat(32_000) }],
      subscribe: vi.fn(() => () => undefined),
      prompt: vi.fn(async () => undefined),
      waitForIdle: vi.fn(async () => undefined),
      getSessionStats: vi.fn(() => ({
        tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 },
        cost: 0.01,
      })),
      dispose: vi.fn(),
      abort: vi.fn(async () => undefined),
    } as unknown as AgentSession));
    const worker = new PiAgentWorker({
      workspaceRepository: {
        get: vi.fn(async () => ({ path: "/workspace/project" })),
      } as unknown as StoryForgeWorkspaceStore,
      piModels: {
        resolveModel: vi.fn(async () => ({ provider: "deepseek", id: "chat" })),
        getModelRuntime: vi.fn(async () => ({})),
        getAgentDir: vi.fn(() => "/tmp/agent"),
      } as unknown as PiModelService,
      piSessions: {
        createAgentExecutionSession,
      } as unknown as PiSessionAdapter,
      createAgentSession,
    });
    const onTranscriptCreated = vi.fn(async () => undefined);

    const result = await worker.run({
      sessionId: "sf_session_test",
      workspaceId: "workspace-1",
      turnId: "sf_turn_test",
      executionId: "sf_agent_execution_test",
      role: "explorer",
      task: { role: "explorer", objective: "Inspect the project" },
      providerId: "deepseek",
      model: "chat",
      signal: new AbortController().signal,
      onTranscriptCreated,
    });

    expect(createAgentExecutionSession).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      turnId: "sf_turn_test",
      executionId: "sf_agent_execution_test",
    });
    expect(onTranscriptCreated).toHaveBeenCalledWith("/tmp/child.jsonl");
    expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      resourcePolicy: "isolated-child",
      additionalExtensionPaths: [],
      additionalSkillPaths: [],
      builtInToolNames: ["read", "grep", "find", "ls"],
    }));
    expect(result).toMatchObject({
      status: "completed",
      truncated: true,
      transcriptFile: "/tmp/child.jsonl",
    });
    expect(Buffer.byteLength(JSON.stringify(result.report), "utf8"))
      .toBeLessThanOrEqual(16 * 1024);
  });
});
