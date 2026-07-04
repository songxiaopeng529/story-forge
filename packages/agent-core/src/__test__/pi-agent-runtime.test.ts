import type { ChatRequest, ModelProvider } from "@story-forge/model-gateway";
import type { AgentEvent, SessionId, TurnId } from "@story-forge/shared";
import { ToolRegistry } from "@story-forge/tools";
import { describe, expect, it } from "vitest";
import { PiAgentRuntime } from "../pi-agent-runtime";
import {
  RuntimeContextAssembler,
  type RuntimePersistedMessage,
  type RuntimeSession,
} from "../runtime-context";

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

describe("PiAgentRuntime", () => {
  it("runs the PI agent loop and checkpoints assistant messages", async () => {
    const checkpoints: RuntimePersistedMessage[][] = [];
    const fixture = createRuntimeFixture({
      messages: [userMessage("Say hello")],
      provider: fakeProvider(async () => ({ content: "Hello from PI.", toolCalls: [] })),
      onCheckpoint: (messages) => checkpoints.push(messages),
    });

    const events = await collectEvents(fixture.runtime.runTurn({
      sessionId,
      turnId,
      prompt: "Say hello",
    }));

    expect(events).toContainEqual(expect.objectContaining({
      type: "message.delta",
      content: "Hello from PI.",
      delivery: "smooth",
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "runtime.completed",
      stopReason: "completed",
    }));
    expect(checkpoints.at(-1)?.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(checkpoints.at(-1)?.[1]).toMatchObject({
      role: "assistant",
      content: "Hello from PI.",
    });
  });

  it("adapts StoryForge tools without exposing PI built-in tools", async () => {
    const requestedToolNames: string[][] = [];
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
      provider: fakeProvider(async (request) => {
        requestedToolNames.push((request.tools ?? []).map((tool) => tool.name));
        requestCount += 1;
        return requestCount === 1
          ? {
              content: "",
              toolCalls: [{ id: "call_1", name: "story.echo", input: { text: "forge" } }],
            }
          : { content: "Done.", toolCalls: [] };
      }),
      tools,
      onCheckpoint: (messages) => checkpoints.push(messages),
    });

    const events = await collectEvents(fixture.runtime.runTurn({
      sessionId,
      turnId,
      prompt: "Use a tool",
    }));

    expect(requestedToolNames[0]).toEqual(["story.echo"]);
    expect(requestedToolNames.flat()).not.toEqual(expect.arrayContaining([
      "read",
      "write",
      "edit",
      "bash",
    ]));
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.call",
      callId: "call_1",
      name: "story.echo",
      input: { text: "forge" },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.result",
      callId: "call_1",
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
      tools: [],
    }));
  });

  it("streams provider deltas as live StoryForge message deltas", async () => {
    const fixture = createRuntimeFixture({
      messages: [userMessage("Stream response")],
      responseMode: "live",
      provider: {
        id: "streaming-fake",
        capabilities: {
          toolCalling: true,
          streaming: true,
          jsonSchema: false,
          contextWindowTokens: 4096,
        },
        chat: async () => {
          throw new Error("smooth chat should not be used");
        },
        async *streamChat() {
          yield { type: "content.delta" as const, content: "Hel" };
          yield { type: "content.delta" as const, content: "lo" };
          yield {
            type: "done" as const,
            response: { content: "Hello", toolCalls: [] },
          };
        },
      },
    });

    const events = await collectEvents(fixture.runtime.runTurn({
      sessionId,
      turnId,
      prompt: "Stream response",
    }));

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "message.delta",
        content: "Hel",
        delivery: "live",
      }),
      expect.objectContaining({
        type: "message.delta",
        content: "lo",
        delivery: "live",
      }),
    ]));
  });
});

function createRuntimeFixture(input: {
  messages: RuntimePersistedMessage[];
  provider: ModelProvider;
  tools?: ToolRegistry;
  developerMode?: boolean;
  responseMode?: "auto" | "live" | "smooth";
  onCheckpoint?: (messages: RuntimePersistedMessage[]) => void;
}) {
  let session: RuntimeSession = {
    id: sessionId,
    workspaceId: "workspace-1",
    providerId: "deepseek",
    model: "deepseek-v4-pro",
    messages: input.messages,
    tasks: [],
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
      getResponseMode: async () => input.responseMode ?? "smooth",
      getDeveloperMode: async () => input.developerMode ?? false,
      getCommandExecutionMode: async () => "sentinel",
      getWebAccessEnabled: async () => false,
      getWebSearchCoverage: async () => "focused",
    },
  });

  return {
    runtime: new PiAgentRuntime({
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
        listTasks: async () => session.tasks ?? [],
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
    request: ChatRequest,
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
    chat: (request, options) => handler(request, options?.signal),
  };
}
