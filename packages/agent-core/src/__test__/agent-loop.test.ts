import type { ChatMessage, ChatStreamEvent, ModelProvider } from "@story-forge/model-gateway";
import type { AgentEvent, SessionId, TurnId } from "@story-forge/shared";
import { ToolRegistry } from "@story-forge/tools";
import { describe, expect, it } from "vitest";
import { AgentLoop, trimMessagesToContext } from "../agent-loop";
import { ContextCompactor } from "../context-compactor";

const sessionId = "sf_session_test" satisfies SessionId;
const turnId = "sf_turn_test" satisfies TurnId;

describe("AgentLoop", () => {
  it("emits model request events before chat when inspection is enabled", async () => {
    const events: AgentEvent[] = [];
    let chatCalls = 0;
    const provider = fakeProvider(async () => {
      chatCalls += 1;
      return { content: "Done", toolCalls: [] };
    });

    await new AgentLoop({ provider, tools: new ToolRegistry() }).run({
      sessionId,
      turnId,
      responseMode: "smooth",
      inspectModelRequests: {
        enabled: true,
        providerId: "deepseek",
        model: "deepseek-v4-pro",
      },
      messages: [{ role: "user", content: "Hello" }],
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(chatCalls).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({
      type: "model.request",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      responseMode: "smooth",
      messages: [{ role: "user", content: "Hello" }],
    }));
  });

  it("does not emit model request events when inspection is disabled", async () => {
    const events: AgentEvent[] = [];

    await new AgentLoop({
      provider: fakeProvider(async () => ({ content: "Done", toolCalls: [] })),
      tools: new ToolRegistry(),
    }).run({
      sessionId,
      turnId,
      messages: [{ role: "user", content: "Hello" }],
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events.some((event) => event.type === "model.request")).toBe(false);
  });

  it("emits estimated context usage before each request", async () => {
    const events: AgentEvent[] = [];

    await new AgentLoop({
      provider: fakeProvider(async () => ({ content: "Done", toolCalls: [] })),
      tools: new ToolRegistry(),
    }).run({
      sessionId,
      turnId,
      messages: [{ role: "user", content: "Hello" }],
      onEvent: (event) => {
        events.push(event);
      },
    });

    const usageEvents = events.filter((event) => event.type === "context.usage");
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      type: "context.usage",
      source: "estimate",
      budgetTokens: 800,
      windowTokens: 1000,
    });
    expect((usageEvents[0] as Extract<AgentEvent, { type: "context.usage" }>).usedTokens)
      .toBeGreaterThan(0);
  });

  it("emits provider-accurate context usage when the model reports usage", async () => {
    const events: AgentEvent[] = [];

    await new AgentLoop({
      provider: fakeProvider(async () => ({
        content: "Done",
        toolCalls: [],
        usage: { promptTokens: 512 },
      })),
      tools: new ToolRegistry(),
    }).run({
      sessionId,
      turnId,
      messages: [{ role: "user", content: "Hello" }],
      onEvent: (event) => {
        events.push(event);
      },
    });

    const providerUsage = events.find(
      (event): event is Extract<AgentEvent, { type: "context.usage" }> =>
        event.type === "context.usage" && event.source === "provider",
    );
    expect(providerUsage).toMatchObject({
      usedTokens: 512,
      budgetTokens: 800,
      windowTokens: 1000,
    });
  });

  it("auto-compacts once when provider usage crosses the threshold", async () => {
    const events: AgentEvent[] = [];
    const checkpoints: ChatMessage[][] = [];
    let summarizeCalls = 0;
    const provider = compactionProvider({
      onSummarize: () => {
        summarizeCalls += 1;
      },
    });
    const tools = new ToolRegistry([noopTool()]);

    const result = await new AgentLoop({ provider, tools, compactor: new ContextCompactor() }).run({
      sessionId,
      turnId,
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "second" },
      ],
      contextCompaction: {
        enabled: true,
        getOpenTasks: async () => [],
      },
      onEvent: (event) => {
        events.push(event);
      },
      onCheckpoint: (messages) => {
        checkpoints.push(messages);
      },
    });

    const compactedEvents = events.filter((event) => event.type === "context.compacted");
    expect(compactedEvents).toHaveLength(1);
    expect(compactedEvents[0]).toMatchObject({ trigger: "auto", retainedRounds: 1 });
    expect(summarizeCalls).toBe(1);
    expect(result.stopReason).toBe("completed");
    const persisted = checkpoints.at(-1) ?? result.messages;
    expect(persisted.some(
      (message) => message.role === "assistant" && message.kind === "summary",
    )).toBe(true);
  });

  it("does not auto-compact without a compactor configured", async () => {
    const events: AgentEvent[] = [];
    const provider = compactionProvider();

    await new AgentLoop({ provider, tools: new ToolRegistry([noopTool()]) }).run({
      sessionId,
      turnId,
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "second" },
      ],
      contextCompaction: {
        enabled: true,
        getOpenTasks: async () => [],
      },
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events.some((event) => event.type === "context.compacted")).toBe(false);
  });

  it("does not auto-compact when usage is only estimated", async () => {
    const events: AgentEvent[] = [];
    const provider = fakeProvider(async () => ({ content: "Done", toolCalls: [] }));

    await new AgentLoop({ provider, tools: new ToolRegistry(), compactor: new ContextCompactor() }).run({
      sessionId,
      turnId,
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "second" },
      ],
      contextCompaction: {
        enabled: true,
        getOpenTasks: async () => [],
      },
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events.some((event) => event.type === "context.compacted")).toBe(false);
  });

  it("continues the turn when summarization fails", async () => {
    const events: AgentEvent[] = [];
    const provider = compactionProvider({
      onSummarize: () => {
        throw new Error("summarize failed");
      },
    });

    const result = await new AgentLoop({
      provider,
      tools: new ToolRegistry([noopTool()]),
      compactor: new ContextCompactor(),
    }).run({
      sessionId,
      turnId,
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "second" },
      ],
      contextCompaction: {
        enabled: true,
        getOpenTasks: async () => [],
      },
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events.some((event) => event.type === "context.compacted")).toBe(false);
    expect(result.stopReason).toBe("completed");
  });

  it("uses chat in smooth mode and ignores streamChat when available", async () => {
    const events: AgentEvent[] = [];
    let chatCalls = 0;
    let streamCalls = 0;
    const provider: ModelProvider = {
      id: "smooth-fake",
      capabilities: {
        toolCalling: true,
        streaming: true,
        jsonSchema: false,
        contextWindowTokens: 1000,
      },
      chat: async () => {
        chatCalls += 1;
        return { content: "Smooth answer", toolCalls: [] };
      },
      async *streamChat() {
        streamCalls += 1;
        yield { type: "done", response: { content: "unexpected", toolCalls: [] } };
      },
    };

    const result = await new AgentLoop({ provider, tools: new ToolRegistry() }).run({
      sessionId,
      turnId,
      responseMode: "smooth",
      messages: [{ role: "user", content: "Use smooth" }],
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(chatCalls).toBe(1);
    expect(streamCalls).toBe(0);
    expect(events).toContainEqual({
      type: "message.delta",
      sessionId,
      turnId,
      content: "Smooth answer",
      delivery: "smooth",
    });
    expect(result.messages.at(-1)).toEqual({ role: "assistant", content: "Smooth answer" });
  });

  it("uses streamChat in live mode and emits live deltas", async () => {
    const events: AgentEvent[] = [];
    const result = await new AgentLoop({
      provider: streamingProvider([
        { type: "content.delta", content: "Hel" },
        { type: "content.delta", content: "lo" },
        { type: "done", response: { content: "Hello", toolCalls: [] } },
      ]),
      tools: new ToolRegistry(),
    }).run({
      sessionId,
      turnId,
      responseMode: "live",
      messages: [{ role: "user", content: "Say hello" }],
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events).toContainEqual({
      type: "message.delta",
      sessionId,
      turnId,
      content: "Hel",
      delivery: "live",
    });
    expect(events).toContainEqual({
      type: "message.delta",
      sessionId,
      turnId,
      content: "lo",
      delivery: "live",
    });
    expect(result.messages.at(-1)).toEqual({ role: "assistant", content: "Hello" });
  });

  it("reports auto streaming errors after live content without smooth fallback", async () => {
    const events: AgentEvent[] = [];
    let chatCalls = 0;
    const provider: ModelProvider = {
      id: "partial-stream-fake",
      capabilities: {
        toolCalling: true,
        streaming: true,
        jsonSchema: false,
        contextWindowTokens: 1000,
      },
      chat: async () => {
        chatCalls += 1;
        return { content: "Smooth answer", toolCalls: [] };
      },
      async *streamChat() {
        yield { type: "content.delta", content: "Partial" };
        throw new Error("stream failed after content");
      },
    };

    const result = await new AgentLoop({ provider, tools: new ToolRegistry() }).run({
      sessionId,
      turnId,
      responseMode: "auto",
      messages: [{ role: "user", content: "Recover carefully" }],
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(chatCalls).toBe(0);
    expect(result.stopReason).toBe("unrecoverable-error");
    expect(events).toContainEqual({
      type: "message.delta",
      sessionId,
      turnId,
      content: "Partial",
      delivery: "live",
    });
    expect(events).not.toContainEqual(expect.objectContaining({ type: "response.fallback" }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: "message.delta",
      delivery: "smooth",
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "runtime.error",
      message: "stream failed after content",
    }));
  });

  it("falls back from auto streaming to smooth chat before content arrives", async () => {
    const events: AgentEvent[] = [];
    const provider: ModelProvider = {
      id: "fallback-fake",
      capabilities: {
        toolCalling: true,
        streaming: true,
        jsonSchema: false,
        contextWindowTokens: 1000,
      },
      chat: async () => ({ content: "Smooth answer", toolCalls: [] }),
      async *streamChat() {
        throw new Error("network stream failed");
      },
    };

    await new AgentLoop({ provider, tools: new ToolRegistry() }).run({
      sessionId,
      turnId,
      responseMode: "auto",
      messages: [{ role: "user", content: "Recover" }],
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events).toContainEqual({
      type: "response.fallback",
      sessionId,
      turnId,
      from: "live",
      to: "smooth",
      reason: "network stream failed",
    });
    expect(events).toContainEqual({
      type: "message.delta",
      sessionId,
      turnId,
      content: "Smooth answer",
      delivery: "smooth",
    });
  });

  it("does not fall back from auto streaming when the turn is aborted", async () => {
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    let chatCalls = 0;
    const provider: ModelProvider = {
      id: "aborted-stream-fake",
      capabilities: {
        toolCalling: true,
        streaming: true,
        jsonSchema: false,
        contextWindowTokens: 1000,
      },
      chat: async () => {
        chatCalls += 1;
        return { content: "Smooth answer", toolCalls: [] };
      },
      async *streamChat() {
        controller.abort();
        throw new Error("stream aborted");
      },
    };

    const result = await new AgentLoop({ provider, tools: new ToolRegistry() }).run({
      sessionId,
      turnId,
      responseMode: "auto",
      messages: [{ role: "user", content: "Abort" }],
      signal: controller.signal,
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(chatCalls).toBe(0);
    expect(result.stopReason).toBe("user-stopped");
    expect(events).not.toContainEqual(expect.objectContaining({ type: "response.fallback" }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: "message.delta",
      delivery: "smooth",
    }));
  });

  it("reports unsupported live streaming as an unrecoverable live-mode error", async () => {
    const provider = fakeProvider(async () => ({ content: "unexpected", toolCalls: [] }));
    const events: AgentEvent[] = [];

    const result = await new AgentLoop({ provider, tools: new ToolRegistry() }).run({
      sessionId,
      turnId,
      responseMode: "live",
      messages: [{ role: "user", content: "Live only" }],
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(result.stopReason).toBe("unrecoverable-error");
    expect(events).toContainEqual(expect.objectContaining({
      type: "runtime.error",
      message: "Live streaming is not available for fake.",
    }));
  });

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

  it("runs a finish guard before completing a no-tool response", async () => {
    const provider = fakeProvider(async () => ({ content: "Done", toolCalls: [] }));
    const checkpoints: ChatMessage[][] = [];

    const result = await new AgentLoop({ provider, tools: new ToolRegistry() }).run({
      sessionId,
      turnId,
      messages: [{ role: "user", content: "Finish" }],
      onBeforeFinish: async () => ({ action: "finish" }),
      onCheckpoint: (messages) => {
        checkpoints.push(messages);
      },
    });

    expect(result.stopReason).toBe("completed");
    expect(checkpoints).toHaveLength(1);
  });

  it("continues the loop when the finish guard returns a reminder message", async () => {
    const requests: ChatMessage[][] = [];
    let requestCount = 0;
    const provider = fakeProvider(async (messages) => {
      requests.push(messages);
      requestCount += 1;
      return {
        content: requestCount === 1 ? "I think I am done" : "Now done",
        toolCalls: [],
      };
    });
    let guardCalls = 0;

    const result = await new AgentLoop({ provider, tools: new ToolRegistry() }).run({
      sessionId,
      turnId,
      messages: [{ role: "user", content: "Finish everything" }],
      onBeforeFinish: async () => {
        guardCalls += 1;
        if (guardCalls === 1) {
          return {
            action: "continue",
            message: {
              role: "user",
              content: "Known tasks remain pending or in progress.",
            },
          };
        }
        return { action: "finish" };
      },
    });

    expect(guardCalls).toBe(2);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toContainEqual({
      role: "user",
      content: "Known tasks remain pending or in progress.",
    });
    expect(result.messages.at(-1)).toEqual({ role: "assistant", content: "Now done" });
    expect(result.stopReason).toBe("completed");
  });

  it("uses the finish guard stop reason when the guard refuses completion", async () => {
    const provider = fakeProvider(async () => ({ content: "Done", toolCalls: [] }));

    const result = await new AgentLoop({ provider, tools: new ToolRegistry() }).run({
      sessionId,
      turnId,
      messages: [{ role: "user", content: "Finish" }],
      onBeforeFinish: async () => ({
        action: "finish",
        stopReason: "unfinished-tasks",
      }),
    });

    expect(result.stopReason).toBe("unfinished-tasks");
  });

  it("executes tool calls sequentially and replays reasoning and results to the model", async () => {
    const events: AgentEvent[] = [];
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
      inspectModelRequests: {
        enabled: true,
        providerId: "deepseek",
        model: "deepseek-v4-pro",
      },
      messages: [{ role: "user", content: "Run both tools" }],
      onEvent: (event) => {
        events.push(event);
      },
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
    expect(events.filter((event) => event.type === "model.request")).toHaveLength(2);
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

function compactionProvider(options: { onSummarize?: () => void } = {}): ModelProvider {
  let realCalls = 0;
  return {
    id: "compaction-fake",
    capabilities: {
      toolCalling: true,
      streaming: false,
      jsonSchema: false,
      contextWindowTokens: 1000,
    },
    chat: async ({ messages }) => {
      const last = messages.at(-1);
      const lastText = typeof last?.content === "string" ? last.content : "";
      if (lastText.includes("上下文压缩")) {
        options.onSummarize?.();
        return { content: "结构化摘要", toolCalls: [] };
      }
      realCalls += 1;
      if (realCalls === 1) {
        return {
          content: "",
          toolCalls: [{ id: `call_${realCalls}`, name: "test.noop", input: {} }],
          usage: { promptTokens: 760 },
        };
      }
      return { content: "Done", toolCalls: [] };
    },
  };
}

function noopTool() {
  return {
    name: "test.noop",
    description: "No-op tool",
    parameters: { type: "object" },
    execute: async () => ({ ok: true }),
  };
}

function streamingProvider(events: ChatStreamEvent[]): ModelProvider {
  return {
    id: "streaming-fake",
    capabilities: {
      toolCalling: true,
      streaming: true,
      jsonSchema: false,
      contextWindowTokens: 1000,
    },
    chat: async () => {
      throw new Error("chat should not be called");
    },
    async *streamChat() {
      for (const event of events) {
        yield event;
      }
    },
  };
}
