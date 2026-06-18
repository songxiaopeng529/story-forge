import type {
  AssistantChatMessage,
  ChatResponse,
  ChatMessage,
  ChatStreamEvent,
  ModelProvider,
  ToolCall,
} from "@story-forge/model-gateway";
import type {
  AgentEvent,
  AgentStopReason,
  MessageDeliveryMode,
  ResponseMode,
  SessionId,
  TurnId,
} from "@story-forge/shared";
import type { ToolRegistry } from "@story-forge/tools";

const DEFAULT_MAX_STEPS = 1000;
const DEFAULT_MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const MAX_REPEATED_TOOL_CALLS = 3;
const MAX_CONSECUTIVE_TOOL_FAILURES = 5;

export type AgentLoopOptions = {
  provider: ModelProvider;
  tools: ToolRegistry;
  maxSteps?: number;
  maxDurationMs?: number;
  now?: () => number;
};

export type AgentLoopRunInput = {
  sessionId: SessionId;
  turnId: TurnId;
  responseMode?: ResponseMode;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
  onCheckpoint?: (messages: ChatMessage[]) => void | Promise<void>;
};

export type AgentLoopResult = {
  messages: ChatMessage[];
  stopReason: AgentStopReason;
  steps: number;
};

type ModelRequest = {
  messages: ChatMessage[];
  tools: ReturnType<ToolRegistry["schemas"]>;
};

type EventSink = {
  sessionId: SessionId;
  turnId: TurnId;
  onEvent?: ((event: AgentEvent) => void | Promise<void>) | undefined;
};

export class AgentLoop {
  private readonly provider: ModelProvider;
  private readonly tools: ToolRegistry;
  private readonly maxSteps: number;
  private readonly maxDurationMs: number;
  private readonly now: () => number;

  constructor(options: AgentLoopOptions) {
    this.provider = options.provider;
    this.tools = options.tools;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    this.now = options.now ?? Date.now;
  }

  async run(input: AgentLoopRunInput): Promise<AgentLoopResult> {
    const messages = [...input.messages];
    const startedAt = this.now();
    const abort = createLoopAbort(input.signal, this.maxDurationMs);
    let steps = 0;
    let previousToolSignature: string | undefined;
    let repeatedToolCalls = 0;
    let consecutiveToolFailures = 0;

    await emit(input, {
      type: "runtime.started",
      sessionId: input.sessionId,
      turnId: input.turnId,
      createdAt: new Date().toISOString(),
    });

    const finish = async (stopReason: AgentStopReason): Promise<AgentLoopResult> => {
      abort.cleanup();
      await emit(input, {
        type: "runtime.completed",
        sessionId: input.sessionId,
        turnId: input.turnId,
        stopReason,
        steps,
      });
      return { messages, stopReason, steps };
    };

    try {
      while (true) {
        const preflightStop = getStopReason({
          externalSignal: input.signal,
          timeLimitReached: abort.timeLimitReached(),
          elapsedMs: this.now() - startedAt,
          maxDurationMs: this.maxDurationMs,
          steps,
          maxSteps: this.maxSteps,
        });
        if (preflightStop) {
          return await finish(preflightStop);
        }

        steps += 1;
        const response = await this.requestModelResponse({
          request: {
            messages: trimMessagesToContext(
              messages,
              Math.floor(this.provider.capabilities.contextWindowTokens * 0.8),
            ),
            tools: this.tools.schemas(),
          },
          options: { signal: abort.signal },
          responseMode: input.responseMode ?? "auto",
          sessionId: input.sessionId,
          turnId: input.turnId,
          onEvent: input.onEvent,
        });
        const assistantMessage: AssistantChatMessage = {
          role: "assistant",
          content: response.content,
          ...(response.reasoningContent ? { reasoningContent: response.reasoningContent } : {}),
          ...(response.toolCalls.length ? { toolCalls: response.toolCalls } : {}),
        };
        messages.push(assistantMessage);

        if (response.toolCalls.length === 0) {
          await checkpoint(input, messages);
          return await finish("completed");
        }

        for (let index = 0; index < response.toolCalls.length; index += 1) {
          const toolCall = response.toolCalls[index];
          if (!toolCall) {
            continue;
          }

          const signature = createToolSignature(toolCall);
          if (signature === previousToolSignature) {
            repeatedToolCalls += 1;
          } else {
            previousToolSignature = signature;
            repeatedToolCalls = 1;
          }
          if (repeatedToolCalls >= MAX_REPEATED_TOOL_CALLS) {
            appendSkippedToolResults(messages, response.toolCalls.slice(index), "repeated-tool-call");
            await checkpoint(input, messages);
            return await finish("repeated-tool-call");
          }

          const toolStop = getStopReason({
            externalSignal: input.signal,
            timeLimitReached: abort.timeLimitReached(),
            elapsedMs: this.now() - startedAt,
            maxDurationMs: this.maxDurationMs,
            steps,
            maxSteps: this.maxSteps,
          });
          if (toolStop) {
            appendSkippedToolResults(messages, response.toolCalls.slice(index), toolStop);
            await checkpoint(input, messages);
            return await finish(toolStop);
          }

          await emit(input, {
            type: "tool.call",
            sessionId: input.sessionId,
            turnId: input.turnId,
            callId: toolCall.id,
            name: toolCall.name,
            input: toolCall.input,
          });
          steps += 1;
          const result = await this.tools.execute(toolCall.name, toolCall.input, {
            signal: abort.signal,
          });
          messages.push({
            role: "tool",
            name: toolCall.name,
            toolCallId: toolCall.id,
            content: result.ok ? serializeToolOutput(result.output) : result.error,
          });
          await emit(input, {
            type: "tool.result",
            sessionId: input.sessionId,
            turnId: input.turnId,
            callId: toolCall.id,
            name: toolCall.name,
            ok: result.ok,
            output: result.ok ? result.output : result.error,
          });

          consecutiveToolFailures = result.ok ? 0 : consecutiveToolFailures + 1;
          if (consecutiveToolFailures >= MAX_CONSECUTIVE_TOOL_FAILURES) {
            appendSkippedToolResults(
              messages,
              response.toolCalls.slice(index + 1),
              "consecutive-tool-failures",
            );
            await checkpoint(input, messages);
            return await finish("consecutive-tool-failures");
          }
        }
        await checkpoint(input, messages);
      }
    } catch (error) {
      const stopReason = input.signal?.aborted
        ? "user-stopped"
        : abort.timeLimitReached()
          ? "time-limit"
          : "unrecoverable-error";
      if (stopReason !== "unrecoverable-error") {
        return await finish(stopReason);
      }

      abort.cleanup();
      await emit(input, {
        type: "runtime.error",
        sessionId: input.sessionId,
        turnId: input.turnId,
        message: error instanceof Error ? error.message : String(error),
        stopReason,
        steps,
      });
      return { messages, stopReason, steps };
    }
  }

  private async requestModelResponse(input: {
    request: ModelRequest;
    options: { signal: AbortSignal };
    responseMode: ResponseMode;
  } & EventSink): Promise<ChatResponse> {
    if (input.responseMode === "smooth") {
      return this.requestSmoothResponse({ ...input, delivery: "smooth" });
    }
    if (!this.provider.streamChat) {
      if (input.responseMode === "live") {
        throw new Error(`Live streaming is not available for ${this.provider.id}.`);
      }
      return this.requestSmoothResponse({ ...input, delivery: "smooth" });
    }

    try {
      return await this.requestStreamingResponse(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (input.responseMode === "auto") {
        await emit(input, {
          type: "response.fallback",
          sessionId: input.sessionId,
          turnId: input.turnId,
          from: "live",
          to: "smooth",
          reason: message,
        });
        return this.requestSmoothResponse({ ...input, delivery: "smooth" });
      }
      throw error;
    }
  }

  private async requestSmoothResponse(input: {
    request: ModelRequest;
    options: { signal: AbortSignal };
    delivery: MessageDeliveryMode;
  } & EventSink): Promise<ChatResponse> {
    const response = await this.provider.chat(input.request, input.options);
    if (response.content) {
      await emit(input, {
        type: "message.delta",
        sessionId: input.sessionId,
        turnId: input.turnId,
        content: response.content,
        delivery: input.delivery,
      });
    }
    return response;
  }

  private async requestStreamingResponse(input: {
    request: ModelRequest;
    options: { signal: AbortSignal };
  } & EventSink): Promise<ChatResponse> {
    let response: ChatResponse | undefined;
    const stream = this.provider.streamChat?.(input.request, input.options) ?? [];
    for await (const event of stream) {
      await this.handleStreamEvent(event, input);
      if (event.type === "done") {
        response = event.response;
      }
    }
    if (!response) {
      throw new Error("Streaming response ended before a final response was received");
    }
    return response;
  }

  private async handleStreamEvent(event: ChatStreamEvent, input: EventSink): Promise<void> {
    if (event.type !== "content.delta") {
      return;
    }
    await emit(input, {
      type: "message.delta",
      sessionId: input.sessionId,
      turnId: input.turnId,
      content: event.content,
      delivery: "live",
    });
  }
}

export function trimMessagesToContext(
  messages: ChatMessage[],
  maxTokens: number,
  estimateTokens: (message: ChatMessage) => number = estimateMessageTokens,
): ChatMessage[] {
  const systemMessages = messages.filter((message) => message.role === "system");
  const rounds = groupConversationRounds(messages.filter((message) => message.role !== "system"));
  const selectedRounds: ChatMessage[][] = [];
  let usedTokens = systemMessages.reduce((total, message) => total + estimateTokens(message), 0);

  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const round = rounds[index];
    if (!round) {
      continue;
    }
    const roundTokens = round.reduce((total, message) => total + estimateTokens(message), 0);
    if (usedTokens + roundTokens > maxTokens) {
      break;
    }
    selectedRounds.unshift(round);
    usedTokens += roundTokens;
  }

  return [...systemMessages, ...selectedRounds.flat()];
}

function groupConversationRounds(messages: ChatMessage[]): ChatMessage[][] {
  const rounds: ChatMessage[][] = [];
  let currentRound: ChatMessage[] = [];

  for (const message of messages) {
    if (message.role === "user" && currentRound.length > 0) {
      rounds.push(currentRound);
      currentRound = [];
    }
    currentRound.push(message);
  }
  if (currentRound.length > 0) {
    rounds.push(currentRound);
  }
  return rounds;
}

function estimateMessageTokens(message: ChatMessage): number {
  return Math.ceil(JSON.stringify(message).length / 4);
}

function createToolSignature(toolCall: ToolCall): string {
  return `${toolCall.name}:${stableStringify(toolCall.input)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function serializeToolOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  const serialized = JSON.stringify(output);
  return serialized ?? String(output);
}

function appendSkippedToolResults(
  messages: ChatMessage[],
  toolCalls: ToolCall[],
  reason: AgentStopReason,
): void {
  for (const toolCall of toolCalls) {
    messages.push({
      role: "tool",
      name: toolCall.name,
      toolCallId: toolCall.id,
      content: `Tool execution skipped: ${reason}`,
    });
  }
}

function getStopReason(input: {
  externalSignal: AbortSignal | undefined;
  timeLimitReached: boolean;
  elapsedMs: number;
  maxDurationMs: number;
  steps: number;
  maxSteps: number;
}): AgentStopReason | undefined {
  if (input.externalSignal?.aborted) {
    return "user-stopped";
  }
  if (input.timeLimitReached || input.elapsedMs >= input.maxDurationMs) {
    return "time-limit";
  }
  if (input.steps >= input.maxSteps) {
    return "step-limit";
  }
  return undefined;
}

function createLoopAbort(externalSignal: AbortSignal | undefined, maxDurationMs: number) {
  const controller = new AbortController();
  let timedOut = maxDurationMs <= 0;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    abortFromExternal();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  }
  const timer = maxDurationMs > 0
    ? setTimeout(() => {
        timedOut = true;
        controller.abort(new Error("Agent loop time limit reached"));
      }, maxDurationMs)
    : undefined;
  timer?.unref?.();

  return {
    signal: controller.signal,
    timeLimitReached: () => timedOut,
    cleanup: () => {
      if (timer) {
        clearTimeout(timer);
      }
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
  };
}

async function emit(input: EventSink, event: AgentEvent): Promise<void> {
  await input.onEvent?.(event);
}

async function checkpoint(input: AgentLoopRunInput, messages: ChatMessage[]): Promise<void> {
  await input.onCheckpoint?.([...messages]);
}
