import type { ModelProvider } from "@story-forge/model-gateway";
import type { AgentEvent } from "@story-forge/shared";
import { ToolRegistry } from "@story-forge/tools";
import { describe, expect, it } from "vitest";
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

describe("NativeAgentRuntime", () => {
  it("streams a started event, assistant content, and a completed event", async () => {
    const provider: ModelProvider = {
      id: "fake",
      capabilities: {
        toolCalling: true,
        streaming: false,
        jsonSchema: false,
        contextWindowTokens: 4096,
      },
      chat: async () => ({ content: "I can help with this repository.", toolCalls: [] }),
    };

    const runtime = new NativeAgentRuntime({
      provider,
      tools: new ToolRegistry(),
      workspaceRoot: "/tmp/story-forge",
    });

    const events = await collectEvents(runtime.runTurn("Review this project"));

    expect(events.map((event) => event.type)).toEqual([
      "runtime.started",
      "message.delta",
      "runtime.completed",
    ]);
    expect(events[0]).toMatchObject({ type: "runtime.started", sessionId: expect.stringMatching(/^sf_session_/) });
    expect(events[1]).toMatchObject({
      type: "message.delta",
      content: "I can help with this repository.",
      sessionId: events[0]?.sessionId,
    });
    expect(events[2]).toMatchObject({ type: "runtime.completed", sessionId: events[0]?.sessionId });
  });

  it("executes one model-requested tool call and returns the tool result event", async () => {
    const provider: ModelProvider = {
      id: "fake",
      capabilities: {
        toolCalling: true,
        streaming: false,
        jsonSchema: false,
        contextWindowTokens: 4096,
      },
      chat: async () => ({
        content: "",
        toolCalls: [{ id: "call_1", name: "story.echo", input: { text: "forge" } }],
      }),
    };

    const tools = new ToolRegistry();
    tools.register({
      name: "story.echo",
      description: "Echoes text",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      execute: async (input) => ({ text: input.text }),
    });

    const runtime = new NativeAgentRuntime({
      provider,
      tools,
      workspaceRoot: "/tmp/story-forge",
    });

    const events = await collectEvents(runtime.runTurn("Use a tool"));

    expect(events).toContainEqual({
      type: "tool.result",
      sessionId: events[0]?.sessionId,
      turnId: events[0]?.turnId,
      callId: "call_1",
      name: "story.echo",
      ok: true,
      output: { text: "forge" },
    });
  });
});
