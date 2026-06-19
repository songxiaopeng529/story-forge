// @vitest-environment node

import type { ModelProvider } from "@story-forge/model-gateway";
import type { AgentEvent } from "@story-forge/shared";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentCoordinator } from "./agent-coordinator";
import { ProviderConfigStore } from "./provider-config-store";
import { SessionRepository } from "./session-repository";
import { WorkspaceRepository } from "./workspace-repository";

describe("AgentCoordinator", () => {
  it("passes the current response mode into the agent loop", async () => {
    const fixture = await createFixture();
    const events: AgentEvent[] = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => ({
          id: "streaming-provider",
          capabilities: {
            toolCalling: true,
            streaming: true,
            jsonSchema: true,
            contextWindowTokens: 1000,
          },
          chat: async () => {
            throw new Error("chat should not be used");
          },
          async *streamChat() {
            yield { type: "content.delta" as const, content: "Hi" };
            yield {
              type: "done" as const,
              response: { content: "Hi", toolCalls: [] },
            };
          },
        }),
      },
      getResponseMode: async () => "live",
      emit: (event) => {
        events.push(event);
      },
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "hello",
    });
    await coordinator.waitForTurn(turnId);

    expect(events).toContainEqual(expect.objectContaining({
      type: "message.delta",
      content: "Hi",
      delivery: "live",
    }));
  });

  it("defaults response mode lookup to auto when not provided", async () => {
    const fixture = await createFixture();
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => ({
          id: "streaming-provider",
          capabilities: {
            toolCalling: true,
            streaming: true,
            jsonSchema: true,
            contextWindowTokens: 1000,
          },
          chat: async () => ({ content: "fallback", toolCalls: [] }),
          async *streamChat() {
            yield { type: "content.delta" as const, content: "Auto" };
            yield {
              type: "done" as const,
              response: { content: "Auto", toolCalls: [] },
            };
          },
        }),
      },
      emit: () => undefined,
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "hello",
    });
    await coordinator.waitForTurn(turnId);

    await expect(fixture.sessionRepository.get(fixture.session.id)).resolves.toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "assistant", content: "Auto" }),
      ]),
    });
  });

  it("passes developer mode inspection into the agent loop", async () => {
    const fixture = await createFixture();
    const events: AgentEvent[] = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider(async () => ({ content: "Done", toolCalls: [] })),
      },
      getResponseMode: async () => "smooth",
      getDeveloperMode: async () => true,
      emit: (event) => {
        events.push(event);
      },
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "hello",
    });
    await coordinator.waitForTurn(turnId);

    expect(events).toContainEqual(expect.objectContaining({
      type: "model.request",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
    }));
  });

  it("does not emit model request events when developer mode is disabled", async () => {
    const fixture = await createFixture();
    const events: AgentEvent[] = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider(async () => ({ content: "Done", toolCalls: [] })),
      },
      getDeveloperMode: async () => false,
      emit: (event) => {
        events.push(event);
      },
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "hello",
    });
    await coordinator.waitForTurn(turnId);

    expect(events.some((event) => event.type === "model.request")).toBe(false);
  });

  it("persists a multi-step tool turn and emits correlated events", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.workspace.path, "README.md"), "workspace contents");
    let requestCount = 0;
    const provider = fakeProvider(async () => {
      requestCount += 1;
      return requestCount === 1
        ? {
            content: "",
            reasoningContent: "I should inspect the workspace.",
            toolCalls: [{
              id: "call_read",
              name: "workspace.readFile",
              input: { path: "README.md" },
            }],
          }
        : { content: "Read complete.", toolCalls: [] };
    });
    const events: Array<{ sessionId: string; turnId: string; type: string }> = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: { createProvider: () => provider },
      emit: (event) => {
        events.push(event);
      },
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "Read the readme",
    });
    await coordinator.waitForTurn(turnId);

    const session = await fixture.sessionRepository.get(fixture.session.id);
    expect(session.status).toBe("completed");
    expect(session.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(session.messages[1]).toMatchObject({
      role: "assistant",
      reasoningContent: "I should inspect the workspace.",
    });
    expect(session.messages[2]).toMatchObject({
      role: "tool",
      ok: true,
      content: "workspace contents",
    });
    expect(events.every((event) =>
      event.sessionId === fixture.session.id && event.turnId === turnId
    )).toBe(true);
  });

  it("aborts an active model request and marks the session stopped", async () => {
    const fixture = await createFixture();
    const provider = fakeProvider((_messages, signal) =>
      new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        void resolve;
      })
    );
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: { createProvider: () => provider },
      emit: () => undefined,
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "Wait",
    });
    await coordinator.stop(turnId);
    await coordinator.waitForTurn(turnId);

    expect(await fixture.sessionRepository.get(fixture.session.id)).toMatchObject({
      status: "stopped",
      stopReason: "user-stopped",
    });
  });

  it("redacts configured secrets from emitted provider errors", async () => {
    const fixture = await createFixture();
    const messages: string[] = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider(async () => {
          throw new Error("provider echoed local-secret");
        }),
      },
      emit: (event) => {
        if (event.type === "runtime.error") {
          messages.push(event.message);
        }
      },
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "Fail safely",
    });
    await coordinator.waitForTurn(turnId);

    expect(messages).toEqual(["provider echoed [REDACTED]"]);
  });

  it("injects an enabled slash-invoked skill as a system message", async () => {
    const fixture = await createFixture();
    const requests: Parameters<ModelProvider["chat"]>[0]["messages"][] = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () =>
          fakeProvider(async (messages) => {
            requests.push(messages);
            return { content: "Reviewed", toolCalls: [] };
          }),
      },
      skillResolver: {
        resolveInvocation: async (command) =>
          command === "/code-review"
            ? {
                id: "code-review",
                name: "Code Review",
                description: "Review code",
                invocationName: "/code-review",
                enabled: true,
                installedAt: "2026-06-19T00:00:00.000Z",
                updatedAt: "2026-06-19T00:00:00.000Z",
                rootDir: "/tmp/skill",
                entrypointPath: "/tmp/skill/SKILL.md",
                body: "Review regressions and missing tests.",
                contentHash: "hash",
              }
            : undefined,
      },
      emit: () => undefined,
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "/code-review focus on regressions",
    });
    await coordinator.waitForTurn(turnId);

    expect(requests[0]).toContainEqual(expect.objectContaining({
      role: "system",
      content: expect.stringContaining("Active StoryForge skill: Code Review"),
    }));
    expect(requests[0]).toContainEqual(expect.objectContaining({
      role: "user",
      content: "/code-review focus on regressions",
    }));
  });

  it("rejects unknown slash skill invocations before appending a user message", async () => {
    const fixture = await createFixture();
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider(async () => ({ content: "unexpected", toolCalls: [] })),
      },
      skillResolver: { resolveInvocation: async () => undefined },
      emit: () => undefined,
    });

    await expect(coordinator.start({
      sessionId: fixture.session.id,
      prompt: "/missing do work",
    })).rejects.toThrow("Skill not found: /missing");
    await expect(fixture.sessionRepository.get(fixture.session.id)).resolves.toMatchObject({
      messages: [],
    });
  });

  it("rejects disabled slash skill invocations with a distinct error", async () => {
    const fixture = await createFixture();
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider(async () => ({ content: "unexpected", toolCalls: [] })),
      },
      skillResolver: {
        resolveInvocation: async () => ({
          id: "code-review",
          name: "Code Review",
          description: "Review code",
          invocationName: "/code-review",
          enabled: false,
          installedAt: "2026-06-19T00:00:00.000Z",
          updatedAt: "2026-06-19T00:00:00.000Z",
          rootDir: "/tmp/skill",
          entrypointPath: "/tmp/skill/SKILL.md",
          body: "Review regressions and missing tests.",
          contentHash: "hash",
        }),
      },
      emit: () => undefined,
    });

    await expect(coordinator.start({
      sessionId: fixture.session.id,
      prompt: "/code-review focus on regressions",
    })).rejects.toThrow("Skill is disabled: /code-review");
    await expect(fixture.sessionRepository.get(fixture.session.id)).resolves.toMatchObject({
      messages: [],
    });
  });

  it("rejects concurrent starts for the same persistent session", async () => {
    const fixture = await createFixture();
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider((_messages, signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          })
        ),
      },
      emit: () => undefined,
    });

    const first = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "First",
    });
    await expect(coordinator.start({
      sessionId: fixture.session.id,
      prompt: "Second",
    })).rejects.toThrow("Session already has an active turn");
    await coordinator.stop(first.turnId);
    await coordinator.waitForTurn(first.turnId);
  });
});

async function createFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "story-forge-coordinator-"));
  const workspacePath = await mkdtemp(join(tmpdir(), "story-forge-workspace-"));
  const providerStore = new ProviderConfigStore({
    rootDir,
    crypto: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${value}`),
      decryptString: (value) => value.toString().replace(/^encrypted:/, ""),
    },
  });
  await providerStore.save({
    providerId: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    apiKey: "local-secret",
  });
  const workspaceRepository = new WorkspaceRepository({ rootDir });
  const workspace = await workspaceRepository.open(workspacePath);
  const sessionRepository = new SessionRepository({ rootDir });
  const session = await sessionRepository.create({
    workspaceId: workspace.id,
    providerId: "deepseek",
    model: "deepseek-v4-pro",
  });
  return {
    providerStore,
    sessionRepository,
    workspaceRepository,
    workspace,
    session,
  };
}

function fakeProvider(
  handler: (
    messages: Parameters<ModelProvider["chat"]>[0]["messages"],
    signal: AbortSignal | undefined,
  ) => ReturnType<ModelProvider["chat"]>,
): ModelProvider {
  return {
    id: "fake",
    capabilities: {
      toolCalling: true,
      streaming: false,
      jsonSchema: false,
      contextWindowTokens: 4096,
    },
    chat: ({ messages }, options) => handler(messages, options?.signal),
  };
}
