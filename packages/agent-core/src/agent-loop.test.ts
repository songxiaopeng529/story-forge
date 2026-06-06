import type { ChatMessage, ModelProvider } from "@story-forge/model-gateway";
import type { SessionId, TurnId } from "@story-forge/shared";
import { ToolRegistry } from "@story-forge/tools";
import { describe, expect, it } from "vitest";
import { AgentLoop, trimMessagesToContext } from "./agent-loop";

const sessionId = "sf_session_test" satisfies SessionId;
const turnId = "sf_turn_test" satisfies TurnId;

describe("AgentLoop", () => {
  it("sends existing multi-turn history and appends the final assistant response", async () => {
    const requests: ChatMessage[][] = [];
    const provider = fakeProvider(async (messages) => {
      requests.push(messages);
      return { content: "Second answer", toolCalls: [] };
    });
    const messages: ChatMessage[] = [
      { role: "system", content: "System" },
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second question" },
    ];

    const result = await new AgentLoop({ provider, tools: new ToolRegistry() }).run({
      sessionId,
      turnId,
      messages,
    });

    expect(requests[0]).toEqual(messages);
    expect(result.messages.at(-1)).toEqual({ role: "assistant", content: "Second answer" });
    expect(result).toMatchObject({ stopReason: "completed", steps: 1 });
  });

  it("executes tool calls sequentially and replays reasoning and results to the model", async () => {
    const requests: ChatMessage[][] = [];
    let requestCount = 0;
    const provider = fakeProvider(async (messages) => {
      requests.push(messages);
      requestCount += 1;
      if (requestCount === 1) {
        return {
          content: "",
          reasoningContent: "Inspect both values.",
          toolCalls: [
            { id: "call_1", name: "test.sequence", input: { value: 1 } },
            { id: "call_2", name: "test.sequence", input: { value: 2 } },
          ],
        };
      }
      return { content: "Finished", toolCalls: [] };
    });
    const executionOrder: number[] = [];
    const checkpoints: ChatMessage[][] = [];
    const tools = new ToolRegistry([
      {
        name: "test.sequence",
        description: "Record execution order",
        parameters: { type: "object" },
        execute: async (input) => {
          executionOrder.push(Number(input.value));
          return { value: input.value };
        },
      },
    ]);

    const result = await new AgentLoop({ provider, tools }).run({
      sessionId,
      turnId,
      messages: [{ role: "user", content: "Run both tools" }],
      onCheckpoint: (messages) => {
        checkpoints.push(messages);
      },
    });

    expect(executionOrder).toEqual([1, 2]);
    expect(requests[1]).toContainEqual({
      role: "assistant",
      content: "",
      reasoningContent: "Inspect both values.",
      toolCalls: [
        { id: "call_1", name: "test.sequence", input: { value: 1 } },
        { id: "call_2", name: "test.sequence", input: { value: 2 } },
      ],
    });
    expect(requests[1]).toContainEqual({
      role: "tool",
      name: "test.sequence",
      toolCallId: "call_1",
      content: JSON.stringify({ value: 1 }),
    });
    expect(checkpoints[0]?.filter((message) => message.role === "tool")).toHaveLength(2);
    expect(result).toMatchObject({ stopReason: "completed", steps: 4 });
  });

  it("stops before exceeding the configured step limit", async () => {
    let executions = 0;
    const provider = fakeProvider(async () => ({
      content: "",
      toolCalls: [{ id: "call_1", name: "test.step", input: {} }],
    }));
    const tools = new ToolRegistry([
      {
        name: "test.step",
        description: "Count executions",
        parameters: { type: "object" },
        execute: () => {
          executions += 1;
        },
      },
    ]);

    const result = await new AgentLoop({ provider, tools, maxSteps: 1 }).run({
      sessionId,
      turnId,
      messages: [{ role: "user", content: "Loop" }],
    });

    expect(executions).toBe(0);
    expect(result).toMatchObject({ stopReason: "step-limit", steps: 1 });
  });

  it("stops when the same tool and arguments are requested three times in a row", async () => {
    let callNumber = 0;
    let executions = 0;
    const provider = fakeProvider(async () => ({
      content: "",
      toolCalls: [{ id: `call_${++callNumber}`, name: "test.repeat", input: { value: 1 } }],
    }));
    const tools = new ToolRegistry([
      {
        name: "test.repeat",
        description: "Repeat",
        parameters: { type: "object" },
        execute: () => {
          executions += 1;
          return "ok";
        },
      },
    ]);

    const result = await new AgentLoop({ provider, tools }).run({
      sessionId,
      turnId,
      messages: [{ role: "user", content: "Repeat" }],
    });

    expect(executions).toBe(2);
    expect(result.stopReason).toBe("repeated-tool-call");
  });

  it("stops after five consecutive tool failures", async () => {
    let callNumber = 0;
    const provider = fakeProvider(async () => ({
      content: "",
      toolCalls: [{
        id: `call_${++callNumber}`,
        name: "test.fail",
        input: { attempt: callNumber },
      }],
    }));

    const result = await new AgentLoop({
      provider,
      tools: new ToolRegistry(),
    }).run({
      sessionId,
      turnId,
      messages: [{ role: "user", content: "Fail" }],
    });

    expect(result).toMatchObject({ stopReason: "consecutive-tool-failures", steps: 10 });
  });

  it("honors cancellation and the total duration limit", async () => {
    const controller = new AbortController();
    controller.abort();
    let requests = 0;
    const provider = fakeProvider(async () => {
      requests += 1;
      return { content: "unexpected", toolCalls: [] };
    });

    const stopped = await new AgentLoop({ provider, tools: new ToolRegistry() }).run({
      sessionId,
      turnId,
      messages: [{ role: "user", content: "Stop" }],
      signal: controller.signal,
    });
    const timedOut = await new AgentLoop({
      provider,
      tools: new ToolRegistry(),
      maxDurationMs: 0,
    }).run({
      sessionId,
      turnId,
      messages: [{ role: "user", content: "Timeout" }],
    });

    expect(stopped.stopReason).toBe("user-stopped");
    expect(timedOut.stopReason).toBe("time-limit");
    expect(requests).toBe(0);
  });
});

describe("trimMessagesToContext", () => {
  it("keeps system messages and recent complete user/tool rounds without splitting them", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "old-user" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "old-call", name: "read", input: {} }],
      },
      { role: "tool", content: "old-result", name: "read", toolCallId: "old-call" },
      { role: "assistant", content: "old-answer" },
      { role: "user", content: "new-user" },
      { role: "assistant", content: "new-answer" },
    ];

    const trimmed = trimMessagesToContext(messages, 5, (message) =>
      message.role === "system" ? 1 : 2,
    );

    expect(trimmed).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "new-user" },
      { role: "assistant", content: "new-answer" },
    ]);
  });
});

function fakeProvider(
  response: (messages: ChatMessage[]) => ReturnType<ModelProvider["chat"]>,
): ModelProvider {
  return {
    id: "fake",
    capabilities: {
      toolCalling: true,
      streaming: false,
      jsonSchema: false,
      contextWindowTokens: 1000,
    },
    chat: ({ messages }) => response(messages),
  };
}
