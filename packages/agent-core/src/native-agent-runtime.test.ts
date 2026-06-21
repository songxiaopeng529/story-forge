import type { ChatMessage, ModelProvider } from "@story-forge/model-gateway";
import type { AgentEvent, SessionId, SkillView, TurnId } from "@story-forge/shared";
import { ToolRegistry } from "@story-forge/tools";
import { describe, expect, it } from "vitest";
import { type RuntimePersistedMessage, type RuntimeSession, RuntimeContextAssembler } from "./runtime-context";
import { NativeAgentRuntime } from "./native-agent-runtime";

function collectEvents(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  return (async () => {
    const events: AgentEvent[] = [];
    for await (const event of iterable) {
      events.push(event);
    }
    return events;
  })();
}

const sessionId = "sf_session_test" as SessionId;
const turnId = "sf_turn_test" as TurnId;

describe("NativeAgentRuntime", () => {
  it("assembles StoryForge context with enabled and active skills", async () => {
    const requests: ChatMessage[][] = [];
    const fixture = createRuntimeFixture({
      messages: [userMessage("/code-review focus on regressions")],
      provider: fakeProvider(async (messages) => {
        requests.push(messages);
        return { content: "Reviewed", toolCalls: [] };
      }),
      skills: {
        enabled: [{
          id: "code-review",
          name: "Code Review",
          description: "Review code",
          invocationName: "/code-review",
          enabled: true,
          installedAt: "2026-06-21T00:00:00.000Z",
          updatedAt: "2026-06-21T00:00:00.000Z",
        }],
        activeBody: "Review regressions and missing tests.",
      },
    });

    const events = await collectEvents(fixture.runtime.runTurn({
      sessionId,
      turnId,
      prompt: "/code-review focus on regressions",
    }));

    expect(events).toContainEqual(expect.objectContaining({
      type: "message.delta",
      content: "Reviewed",
    }));
    expect(requests[0]).toContainEqual(expect.objectContaining({
      role: "system",
      content: expect.stringContaining("Available StoryForge skills"),
    }));
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

  it("runs the native AgentLoop and checkpoints assistant, tool, and final messages", async () => {
    let requestCount = 0;
    const checkpoints: RuntimePersistedMessage[][] = [];
    const tools = new ToolRegistry();
    tools.register({
      name: "story.echo",
      description: "Echoes text",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      execute: async (input) => ({ echoed: input.text }),
    });
    const fixture = createRuntimeFixture({
      messages: [userMessage("Use a tool")],
      provider: fakeProvider(async () => {
        requestCount += 1;
        return requestCount === 1
          ? {
              content: "",
              reasoningContent: "I should use a tool.",
              toolCalls: [{ id: "call_1", name: "story.echo", input: { text: "forge" } }],
            }
          : { content: "Done.", toolCalls: [] };
      }),
      tools,
      onCheckpoint: (messages) => {
        checkpoints.push(messages);
      },
    });

    const events = await collectEvents(fixture.runtime.runTurn({
      sessionId,
      turnId,
      prompt: "Use a tool",
    }));

    expect(events.map((event) => event.type)).toContain("tool.call");
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.result",
      name: "story.echo",
      ok: true,
      output: { echoed: "forge" },
    }));
    expect(checkpoints.at(-1)?.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(checkpoints.at(-1)?.[1]).toMatchObject({
      role: "assistant",
      reasoningContent: "I should use a tool.",
    });
    expect(checkpoints.at(-1)?.[2]).toMatchObject({
      role: "tool",
      name: "story.echo",
      toolCallId: "call_1",
      ok: true,
      content: "{\"echoed\":\"forge\"}",
    });
  });

  it("emits inspectable model requests when developer mode is enabled", async () => {
    const fixture = createRuntimeFixture({
      messages: [userMessage("Inspect request")],
      developerMode: true,
      provider: fakeProvider(async () => ({ content: "Visible", toolCalls: [] })),
    });

    const events = await collectEvents(fixture.runtime.runTurn({
      sessionId,
      turnId,
      prompt: "Inspect request",
    }));

    expect(events).toContainEqual(expect.objectContaining({
      type: "model.request",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "system" }),
        expect.objectContaining({ role: "user", content: "Inspect request" }),
      ]),
    }));
  });
});

function createRuntimeFixture(input: {
  messages: RuntimePersistedMessage[];
  provider: ModelProvider;
  tools?: ToolRegistry;
  developerMode?: boolean;
  skills?: {
    enabled: SkillView[];
    activeBody: string;
  };
  onCheckpoint?: (messages: RuntimePersistedMessage[]) => void;
}) {
  let session: RuntimeSession = {
    id: sessionId,
    workspaceId: "workspace-1",
    providerId: "deepseek",
    model: "deepseek-v4-pro",
    messages: input.messages,
  };
  const contextAssembler = new RuntimeContextAssembler({
    sessionStore: {
      get: async () => session,
      replaceMessages: async (_sessionId, messages) => {
        session = { ...session, messages };
        input.onCheckpoint?.(messages);
        return session;
      },
    },
    workspaceStore: {
      get: async () => ({ id: "workspace-1", path: "/tmp/story-forge" }),
    },
    settings: {
      getResponseMode: async () => "smooth",
      getDeveloperMode: async () => input.developerMode ?? false,
      getCommandExecutionMode: async () => "sentinel",
    },
    skillResolver: {
      list: async () => input.skills?.enabled ?? [],
      resolveInvocation: async (command) =>
        command === "/code-review" && input.skills
          ? {
              ...input.skills.enabled[0]!,
              rootDir: "/tmp/skill",
              entrypointPath: "/tmp/skill/SKILL.md",
              body: input.skills.activeBody,
              contentHash: "hash",
            }
          : undefined,
    },
  });

  return {
    runtime: new NativeAgentRuntime({
      contextAssembler,
      providerResolver: {
        resolve: async () => ({
          providerId: "deepseek",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-pro",
          apiKey: "local-secret",
        }),
      },
      providerFactory: {
        createProvider: () => input.provider,
      },
      toolFactory: {
        createTools: async () => input.tools ?? new ToolRegistry(),
      },
      sessionStore: {
        replaceMessages: async (_sessionId, messages) => {
          session = { ...session, messages };
          input.onCheckpoint?.(messages);
          return session;
        },
      },
    }),
  };
}

function userMessage(content: string): RuntimePersistedMessage {
  return {
    id: `message-${content}`,
    role: "user",
    content,
    createdAt: "2026-06-21T00:00:00.000Z",
  };
}

function fakeProvider(
  handler: (
    messages: ChatMessage[],
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
