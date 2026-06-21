// @vitest-environment node

import type { AgentRuntime } from "@story-forge/agent-core";
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
  it("can host an injected runtime without native loop dependencies", async () => {
    const fixture = await createFixture();
    const events: AgentEvent[] = [];
    const prompts: string[] = [];
    const runtime: AgentRuntime = {
      async *runTurn(input) {
        prompts.push(input.prompt);
        yield {
          type: "runtime.started",
          sessionId: input.sessionId,
          turnId: input.turnId,
          createdAt: "2026-06-21T00:00:00.000Z",
        };
        yield {
          type: "message.delta",
          sessionId: input.sessionId,
          turnId: input.turnId,
          content: "Fake runtime",
        };
        yield {
          type: "runtime.completed",
          sessionId: input.sessionId,
          turnId: input.turnId,
          stopReason: "completed",
        };
      },
    };
    const coordinator = new AgentCoordinator({
      sessionRepository: fixture.sessionRepository,
      runtime,
      emit: (event) => {
        events.push(event);
      },
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "hello runtime",
    });
    await coordinator.waitForTurn(turnId);

    expect(prompts).toEqual(["hello runtime"]);
    expect(events).toContainEqual(expect.objectContaining({
      type: "message.delta",
      content: "Fake runtime",
    }));
    await expect(fixture.sessionRepository.get(fixture.session.id)).resolves.toMatchObject({
      status: "completed",
      messages: [
        expect.objectContaining({ role: "user", content: "hello runtime" }),
      ],
    });
  });

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

  it("emits command permission requests and continues after approval", async () => {
    const fixture = await createFixture();
    let requestCount = 0;
    const provider = fakeProvider(async () => {
      requestCount += 1;
      return requestCount === 1
        ? {
            content: "",
            toolCalls: [{
              id: "call_command",
              name: "workspace.runCommand",
              input: {
                program: "node",
                args: ["-e", "console.log('allowed')"],
              },
            }],
          }
        : { content: "Command complete.", toolCalls: [] };
    });
    const events: AgentEvent[] = [];
    let coordinator: AgentCoordinator;
    coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: { createProvider: () => provider },
      getCommandExecutionMode: async () => "sentinel",
      emit: (event) => {
        events.push(event);
        if (event.type === "permission.request") {
          coordinator.respondToPermission({
            requestId: event.requestId,
            approved: true,
          });
        }
      },
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "Run a command",
    });
    await coordinator.waitForTurn(turnId);

    expect(events).toContainEqual(expect.objectContaining({
      type: "permission.request",
      reason: "Command is outside the safe allowlist.",
      command: expect.objectContaining({
        program: "node",
        args: ["-e", "console.log('allowed')"],
      }),
      mode: "sentinel",
      risk: "unknown",
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.result",
      name: "workspace.runCommand",
      ok: true,
    }));
    await expect(fixture.sessionRepository.get(fixture.session.id)).resolves.toMatchObject({
      status: "completed",
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "assistant", content: "Command complete." }),
      ]),
    });
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
        list: async () => [{
          id: "code-review",
          name: "Code Review",
          description: "Review code",
          invocationName: "/code-review",
          enabled: true,
          installedAt: "2026-06-19T00:00:00.000Z",
          updatedAt: "2026-06-19T00:00:00.000Z",
        }],
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
      role: "system",
      content: expect.stringContaining("workspace.runCommand / workspace_runCommand"),
    }));
    expect(requests[0]).toContainEqual(expect.objectContaining({
      role: "user",
      content: "/code-review focus on regressions",
    }));
  });

  it("lists enabled skills in every model request", async () => {
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
            return { content: "I can use installed skills when requested.", toolCalls: [] };
          }),
      },
      skillResolver: {
        list: async () => [{
          id: "agent-browser",
          name: "agent-browser",
          description: "Browser automation CLI",
          invocationName: "/agent-browser",
          enabled: true,
          installedAt: "2026-06-19T00:00:00.000Z",
          updatedAt: "2026-06-19T00:00:00.000Z",
        }],
        resolveInvocation: async () => undefined,
      },
      emit: () => undefined,
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "你有 agent-browser 这个技能吗？",
    });
    await coordinator.waitForTurn(turnId);

    expect(requests[0]).toContainEqual(expect.objectContaining({
      role: "system",
      content: expect.stringContaining("Available StoryForge skills"),
    }));
    expect(requests[0]).toContainEqual(expect.objectContaining({
      role: "system",
      content: expect.stringContaining("/agent-browser"),
    }));
  });

  it("injects an enabled skill when the prompt explicitly mentions its name", async () => {
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
            return { content: "Yes, agent-browser is available.", toolCalls: [] };
          }),
      },
      skillResolver: {
        list: async () => [{
          id: "agent-browser",
          name: "agent-browser",
          description: "Browser automation CLI",
          invocationName: "/agent-browser",
          enabled: true,
          installedAt: "2026-06-19T00:00:00.000Z",
          updatedAt: "2026-06-19T00:00:00.000Z",
        }],
        resolveInvocation: async (command) =>
          command === "/agent-browser"
            ? {
                id: "agent-browser",
                name: "agent-browser",
                description: "Browser automation CLI",
                invocationName: "/agent-browser",
                enabled: true,
                installedAt: "2026-06-19T00:00:00.000Z",
                updatedAt: "2026-06-19T00:00:00.000Z",
                rootDir: "/tmp/skill",
                entrypointPath: "/tmp/skill/SKILL.md",
                body: "Use the agent-browser CLI to automate browser tasks.",
                contentHash: "hash",
              }
            : undefined,
      },
      emit: () => undefined,
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "你有 agent-browser 这个技能吗？",
    });
    await coordinator.waitForTurn(turnId);

    expect(requests[0]).toContainEqual(expect.objectContaining({
      role: "system",
      content: expect.stringContaining("Active StoryForge skill: agent-browser"),
    }));
    expect(requests[0]).toContainEqual(expect.objectContaining({
      role: "system",
      content: expect.stringContaining("Use the agent-browser CLI"),
    }));
  });

  it("emits an automation proposal event when the model proposes a scheduled task", async () => {
    const fixture = await createFixture();
    let requestCount = 0;
    const events: AgentEvent[] = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider(async () => {
          requestCount += 1;
          return requestCount === 1
            ? {
                content: "",
                toolCalls: [{
                  id: "call_automation",
                  name: "automation.proposeCreate",
                  input: {
                    name: "Daily risk audit",
                    scheduleText: "每天早上 9 点",
                    cron: "0 9 * * *",
                    timezone: "Asia/Shanghai",
                    prompt: "Review the repository risk.",
                  },
                }],
              }
            : { content: "I prepared the automation for confirmation.", toolCalls: [] };
        }),
      },
      emit: (event) => {
        events.push(event);
      },
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "每天早上 9 点帮我检查风险",
    });
    await coordinator.waitForTurn(turnId);

    expect(events).toContainEqual(expect.objectContaining({
      type: "automation.proposal",
      sessionId: fixture.session.id,
      turnId,
      proposal: expect.objectContaining({
        kind: "scheduled_chat",
        name: "Daily risk audit",
        workspaceId: fixture.workspace.id,
        providerId: "deepseek",
        model: "deepseek-v4-pro",
        cron: "0 9 * * *",
        timezone: "Asia/Shanghai",
        summary: "Every day at 09:00",
      }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.result",
      name: "automation.proposeCreate",
      ok: true,
    }));
  });

  it("binds thread automation proposals to the current session", async () => {
    const fixture = await createFixture();
    let requestCount = 0;
    const events: AgentEvent[] = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider(async () => {
          requestCount += 1;
          return requestCount === 1
            ? {
                content: "",
                toolCalls: [{
                  id: "call_thread_timer",
                  name: "automation.proposeCreate",
                  input: {
                    kind: "thread_chat",
                    name: "Thread follow-up",
                    scheduleText: "每小时",
                    cron: "0 * * * *",
                    timezone: "Asia/Shanghai",
                    prompt: "Continue the current investigation.",
                  },
                }],
              }
            : { content: "I prepared the timer for confirmation.", toolCalls: [] };
        }),
      },
      emit: (event) => {
        events.push(event);
      },
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "每小时在这个会话里继续检查一下",
    });
    await coordinator.waitForTurn(turnId);

    expect(events).toContainEqual(expect.objectContaining({
      type: "automation.proposal",
      sessionId: fixture.session.id,
      turnId,
      proposal: expect.objectContaining({
        kind: "thread_chat",
        name: "Thread follow-up",
        sessionId: fixture.session.id,
        workspaceId: fixture.workspace.id,
        cron: "0 * * * *",
      }),
    }));
  });

  it("starts an automation run in a fresh session", async () => {
    const fixture = await createFixture();
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider(async () => ({ content: "Automation done.", toolCalls: [] })),
      },
      emit: () => undefined,
    });

    const { sessionId, turnId } = await coordinator.startAutomationRun({
      workspaceId: fixture.workspace.id,
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      title: "Automation: Daily audit",
      prompt: "Review risk.",
    });
    await coordinator.waitForTurn(turnId);

    await expect(fixture.sessionRepository.get(sessionId)).resolves.toMatchObject({
      workspaceId: fixture.workspace.id,
      title: "Automation: Daily audit",
      messages: [
        expect.objectContaining({ role: "user", content: "Review risk." }),
        expect.objectContaining({ role: "assistant", content: "Automation done." }),
      ],
    });
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
