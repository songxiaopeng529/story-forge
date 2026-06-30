// @vitest-environment node

import type { AgentRuntime } from "@story-forge/agent-core";
import type { ModelProvider } from "@story-forge/model-gateway";
import type { AgentEvent, SessionId } from "@story-forge/shared";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentCoordinator } from "../agent-coordinator";
import { ProviderConfigStore } from "../provider-config-store";
import { SessionRepository } from "../session-repository";
import { WorkspaceRepository } from "../workspace-repository";

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

  it("registers web tools in developer-mode model requests when web access is enabled", async () => {
    const fixture = await createFixture();
    const events: AgentEvent[] = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider(async () => ({ content: "Done", toolCalls: [] })),
      },
      getDeveloperMode: async () => true,
      getWebAccessEnabled: async () => true,
      getWebSearchCoverage: async () => "wide",
      emit: (event) => {
        events.push(event);
      },
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "hello",
    });
    await coordinator.waitForTurn(turnId);

    const modelRequest = events.find((event) => event.type === "model.request");
    expect(modelRequest).toMatchObject({
      type: "model.request",
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "web.search" }),
        expect.objectContaining({ name: "web.fetch" }),
      ]),
    });
  });

  it("registers task tools and write tools in normal mode model requests", async () => {
    const fixture = await createFixture();
    const events: AgentEvent[] = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider(async () => ({ content: "Done", toolCalls: [] })),
      },
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

    expect(modelRequestToolNames(events)).toEqual(expect.arrayContaining([
      "workspace.readFile",
      "workspace.listDirectory",
      "workspace.searchText",
      "workspace.writeFile",
      "workspace.replaceText",
      "workspace.runCommand",
      "automation.proposeCreate",
      "task.create",
      "task.update",
      "task.list",
    ]));
  });

  it("registers only planning-safe tools in plan mode model requests", async () => {
    const fixture = await createFixture();
    const events: AgentEvent[] = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider(async () => ({ content: "Plan ready", toolCalls: [] })),
      },
      getDeveloperMode: async () => true,
      emit: (event) => {
        events.push(event);
      },
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "plan this",
      mode: "plan",
    });
    await coordinator.waitForTurn(turnId);

    const toolNames = modelRequestToolNames(events);
    expect(toolNames).toEqual(expect.arrayContaining([
      "workspace.readFile",
      "workspace.listDirectory",
      "workspace.searchText",
      "workspace.runCommand",
      "task.create",
      "task.update",
      "task.list",
    ]));
    expect(toolNames).not.toContain("workspace.writeFile");
    expect(toolNames).not.toContain("workspace.replaceText");
    expect(toolNames).not.toContain("automation.proposeCreate");
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

  it("emits task update events when the model uses task tools", async () => {
    const fixture = await createFixture();
    let requestCount = 0;
    const events: AgentEvent[] = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider(async (messages) => {
          requestCount += 1;
          if (requestCount === 1) {
            return {
              content: "",
              toolCalls: [{
                id: "call_task_create",
                name: "task.create",
                input: { title: "Inspect runtime" },
              }],
            };
          }
          if (requestCount === 2) {
            const toolMessage = messages.find((message) =>
              message.role === "tool" && message.toolCallId === "call_task_create"
            );
            const toolContent = typeof toolMessage?.content === "string" ? toolMessage.content : "{}";
            const output = JSON.parse(toolContent) as {
              task?: { id?: string };
            };
            return {
              content: "",
              toolCalls: [{
                id: "call_task_update",
                name: "task.update",
                input: {
                  taskId: output.task?.id,
                  status: "completed",
                },
              }],
            };
          }
          return { content: "Tasks updated.", toolCalls: [] };
        }),
      },
      emit: (event) => {
        events.push(event);
      },
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "Track this",
    });
    await coordinator.waitForTurn(turnId);

    expect(events).toContainEqual(expect.objectContaining({
      type: "task.list.updated",
      reason: "created",
      tasks: [expect.objectContaining({
        title: "Inspect runtime",
        status: "pending",
      })],
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "task.list.updated",
      reason: "updated",
      tasks: [expect.objectContaining({
        title: "Inspect runtime",
        status: "completed",
      })],
    }));
    await expect(fixture.sessionRepository.listTasks(fixture.session.id)).resolves.toEqual([
      expect.objectContaining({
        title: "Inspect runtime",
        status: "completed",
        updatedTurnId: turnId,
      }),
    ]);
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
      reason: "This command can run arbitrary code, inspect secrets, or access remote systems.",
      command: expect.objectContaining({
        program: "node",
        args: ["-e", "console.log('allowed')"],
      }),
      mode: "sentinel",
      risk: "high",
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

  it("passes a configured command home into workspace commands", async () => {
    const fixture = await createFixture();
    const commandHome = join(fixture.rootDir, "command-home");
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
                  id: "call_command_home",
                  name: "workspace.runCommand",
                  input: {
                    program: "node",
                    args: ["-e", "console.log(process.env.HOME)"],
                  },
                }],
              }
            : { content: "Done.", toolCalls: [] };
        }),
      },
      commandHome,
      getCommandExecutionMode: async () => "unleashed",
      emit: (event) => {
        events.push(event);
      },
    });

    const { turnId } = await coordinator.start({
      sessionId: fixture.session.id,
      prompt: "Print command home",
    });
    await coordinator.waitForTurn(turnId);

    const toolResult = events.find((event) =>
      event.type === "tool.result" && event.name === "workspace.runCommand"
    );
    expect(toolResult).toMatchObject({
      type: "tool.result",
      ok: true,
      output: expect.objectContaining({
        stdout: `${commandHome}\n`,
      }),
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

    expect(requests[0]).toBeDefined();
    const systemMessage = requests[0]?.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("<storyforge-context version=\"1\">");
    expect(systemMessage?.content).toContain("<skills count=\"1\" active=\"/code-review\">");
    expect(systemMessage?.content).toContain("<active-skill invocation=\"/code-review\" name=\"Code Review\">");
    expect(systemMessage?.content).toContain("workspace.runCommand / workspace_runCommand");
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

    expect(requests[0]).toBeDefined();
    const systemMessage = requests[0]?.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("<storyforge-context version=\"1\">");
    expect(systemMessage?.content).toContain("<skills count=\"1\">");
    expect(systemMessage?.content).toContain("<skill invocation=\"/agent-browser\" name=\"agent-browser\">");
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

    expect(requests[0]).toBeDefined();
    const systemMessage = requests[0]?.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("<storyforge-context version=\"1\">");
    expect(systemMessage?.content).toContain("<skills count=\"1\" active=\"/agent-browser\">");
    expect(systemMessage?.content).toContain("<active-skill invocation=\"/agent-browser\" name=\"agent-browser\">");
    expect(systemMessage?.content).toContain("Use the agent-browser CLI");
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

  it("compacts a session's history and emits a manual context.compacted event", async () => {
    const fixture = await createFixture();
    for (let index = 1; index <= 3; index += 1) {
      await fixture.sessionRepository.appendMessage(fixture.session.id, {
        id: `user-${index}`,
        role: "user",
        content: `request ${index}`,
        createdAt: "2026-06-24T00:00:00.000Z",
      });
      await fixture.sessionRepository.appendMessage(fixture.session.id, {
        id: `assistant-${index}`,
        role: "assistant",
        content: `answer ${index}`,
        createdAt: "2026-06-24T00:00:01.000Z",
      });
    }
    const events: AgentEvent[] = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider(async () => ({
          content: "结构化摘要",
          toolCalls: [],
        })),
      },
      emit: (event) => {
        events.push(event);
      },
    });

    await coordinator.compactSession(fixture.session.id);

    const session = await fixture.sessionRepository.get(fixture.session.id);
    expect(session.messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "结构化摘要", kind: "summary" }),
      expect.objectContaining({ role: "user", content: "request 3", id: "user-3" }),
      expect.objectContaining({ role: "assistant", content: "answer 3", id: "assistant-3" }),
    ]);
    expect(events).toContainEqual(expect.objectContaining({
      type: "context.compacted",
      trigger: "manual",
      retainedRounds: 1,
    }));
  });

  it("rejects compaction while a turn is active", async () => {
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
    await expect(coordinator.compactSession(fixture.session.id)).rejects.toThrow(
      "Session already has an active turn",
    );
    await coordinator.stop(first.turnId);
    await coordinator.waitForTurn(first.turnId);
  });

  it("does not emit an event when history is too short to compact", async () => {
    const fixture = await createFixture();
    await fixture.sessionRepository.appendMessage(fixture.session.id, {
      id: "user-1",
      role: "user",
      content: "only request",
      createdAt: "2026-06-24T00:00:00.000Z",
    });
    const events: AgentEvent[] = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider(async () => ({ content: "unused", toolCalls: [] })),
      },
      emit: (event) => {
        events.push(event);
      },
    });

    await coordinator.compactSession(fixture.session.id);

    expect(events.some((event) => event.type === "context.compacted")).toBe(false);
  });

  it("ignores compaction for a session that is not persisted", async () => {
    const fixture = await createFixture();
    const events: AgentEvent[] = [];
    const coordinator = new AgentCoordinator({
      providerStore: fixture.providerStore,
      sessionRepository: fixture.sessionRepository,
      workspaceRepository: fixture.workspaceRepository,
      providerFactory: {
        createProvider: () => fakeProvider(async () => ({ content: "unused", toolCalls: [] })),
      },
      emit: (event) => {
        events.push(event);
      },
    });

    await expect(
      coordinator.compactSession("sf_session_missing" as SessionId),
    ).resolves.toBeUndefined();
    expect(events.some((event) => event.type === "context.compacted")).toBe(false);
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
    rootDir,
    workspacePath,
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

function modelRequestToolNames(events: AgentEvent[]): string[] {
  const request = events.find((event) => event.type === "model.request");
  if (!request || request.type !== "model.request") {
    return [];
  }
  return request.tools.map((tool) => tool.name);
}
