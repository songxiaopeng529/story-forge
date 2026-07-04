import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context as PiContext,
  ImageContent,
  Message as PiMessage,
  Model,
  TextContent,
  ToolCall as PiToolCall,
  ToolResultMessage,
  Usage,
} from "@earendil-works/pi-ai";
import { runAgentLoopContinue } from "@earendil-works/pi-agent-core";
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentContext as PiAgentContext,
  AgentEvent as PiAgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  AgentToolResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
  StreamFn,
} from "@earendil-works/pi-agent-core";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  ModelProvider,
  ProviderConnectionConfig,
  ToolCall,
} from "@story-forge/model-gateway";
import type {
  AgentEvent,
  AgentStopReason,
  InspectableModelMessage,
  MessageDeliveryMode,
  SessionId,
} from "@story-forge/shared";
import type { ToolRegistry } from "@story-forge/tools";
import { estimateMessagesTokens, trimMessagesToContext } from "./agent-loop";
import type {
  AgentRuntime,
  AgentRuntimeTurnInput,
  RuntimeProviderFactory,
  RuntimeProviderResolver,
  RuntimeSession,
  RuntimeSessionStore,
  RuntimeToolFactory,
} from "./agent-runtime";
import { RuntimeContextAssembler, toRuntimePersistedMessages } from "./runtime-context";

const DEFAULT_MAX_STEPS = 1000;
const DEFAULT_MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const MAX_REPEATED_TOOL_CALLS = 3;
const MAX_CONSECUTIVE_TOOL_FAILURES = 5;
const CONTEXT_BUDGET_RATIO = 0.8;
const MAX_UNFINISHED_TASK_GUARD_REMINDERS = 2;
const UNFINISHED_TASK_REMINDER =
  "Known tasks remain pending or in progress. Continue working on them, or mark tasks blocked with a concrete reason if you cannot proceed.";
const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

export type PiAgentRuntimeOptions = {
  contextAssembler: RuntimeContextAssembler;
  providerResolver: RuntimeProviderResolver;
  providerFactory: RuntimeProviderFactory;
  toolFactory: RuntimeToolFactory;
  sessionStore: Pick<RuntimeSessionStore, "replaceMessages" | "listTasks">;
  maxSteps?: number;
  maxDurationMs?: number;
  now?: () => number;
};

type PiRuntimeState = {
  sessionId: AgentRuntimeTurnInput["sessionId"];
  turnId: AgentRuntimeTurnInput["turnId"];
  providerId: string;
  model: string;
  responseMode: "auto" | "live" | "smooth";
  developerMode: boolean;
  provider: ModelProvider;
  tools: ToolRegistry;
  piMessages: AgentMessage[];
  persistedMessages: RuntimePersistedMessageList;
  toolResults: Map<string, boolean>;
  deliveryMode: MessageDeliveryMode;
  steps: number;
  startedAt: number;
  maxSteps: number;
  maxDurationMs: number;
  timeLimitReached: () => boolean;
  previousToolSignature: string | undefined;
  repeatedToolCalls: number;
  consecutiveToolFailures: number;
  pendingStopReason: AgentStopReason | undefined;
  unfinishedTaskGuardReminders: number;
  pendingFollowUps: AgentMessage[];
  nextModelRequestIndex: number;
  lastProviderUsedTokens: number | undefined;
};

type RuntimePersistedMessageList = RuntimeSession["messages"];

export class PiAgentRuntime implements AgentRuntime {
  private readonly contextAssembler: RuntimeContextAssembler;
  private readonly providerResolver: RuntimeProviderResolver;
  private readonly providerFactory: RuntimeProviderFactory;
  private readonly toolFactory: RuntimeToolFactory;
  private readonly sessionStore: Pick<RuntimeSessionStore, "replaceMessages" | "listTasks">;
  private readonly maxSteps: number;
  private readonly maxDurationMs: number;
  private readonly now: () => number;

  constructor(options: PiAgentRuntimeOptions) {
    this.contextAssembler = options.contextAssembler;
    this.providerResolver = options.providerResolver;
    this.providerFactory = options.providerFactory;
    this.toolFactory = options.toolFactory;
    this.sessionStore = options.sessionStore;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    this.now = options.now ?? Date.now;
  }

  async *runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentEvent> {
    const stream = createEventQueue();
    const execution = this.execute(input, stream.push).finally(stream.close);

    while (true) {
      const next = await stream.next();
      if (next.done) {
        break;
      }
      yield next.value;
    }

    await execution;
  }

  private async execute(
    input: AgentRuntimeTurnInput,
    emitEvent: (event: AgentEvent) => void,
  ): Promise<void> {
    let apiKey: string | undefined;
    try {
      const context = await this.contextAssembler.build(input);
      if (context.tasks.length > 0) {
        emitEvent({
          type: "task.list.updated",
          sessionId: input.sessionId,
          turnId: input.turnId,
          tasks: context.tasks,
          reason: "loaded",
        });
      }

      const resolvedProvider = await this.providerResolver.resolve(context.session.providerId);
      apiKey = resolvedProvider.apiKey;
      const provider = this.providerFactory.createProvider(
        {
          providerId: context.session.providerId,
          baseUrl: resolvedProvider.baseUrl,
          model: context.session.model,
        },
        resolvedProvider.apiKey,
      );
      const tools = await this.toolFactory.createTools(context, {
        ...(input.signal ? { signal: input.signal } : {}),
        emit: (event) => emitEvent(redactEvent(event, apiKey)),
      });
      const abort = createLoopAbort(input.signal, this.maxDurationMs);
      const runtimeState: PiRuntimeState = {
        sessionId: input.sessionId,
        turnId: input.turnId,
        providerId: context.session.providerId,
        model: context.session.model,
        responseMode: context.settings.responseMode,
        developerMode: context.settings.developerMode,
        provider,
        tools,
        piMessages: context.messages.filter(isNonSystemChatMessage).map(toPiMessage),
        persistedMessages: context.session.messages,
        toolResults: new Map<string, boolean>(),
        deliveryMode: "smooth",
        steps: 0,
        startedAt: this.now(),
        maxSteps: this.maxSteps,
        maxDurationMs: this.maxDurationMs,
        timeLimitReached: abort.timeLimitReached,
        previousToolSignature: undefined,
        repeatedToolCalls: 0,
        consecutiveToolFailures: 0,
        pendingStopReason: undefined,
        unfinishedTaskGuardReminders: 0,
        pendingFollowUps: [],
        nextModelRequestIndex: 1,
        lastProviderUsedTokens: undefined,
      };
      const systemPrompt = context.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const piContext: PiAgentContext = {
        systemPrompt,
        messages: runtimeState.piMessages,
        tools: createPiTools(tools, abort.signal),
      };
      const piModel = createPiModel({
        providerId: context.session.providerId,
        model: context.session.model,
        resolvedProvider,
        provider,
      });
      const streamFn = this.createStreamFn(runtimeState, emitEvent);
      const config: AgentLoopConfig = {
        model: piModel,
        convertToLlm: (messages) => messages.filter(isPiMessage),
        transformContext: async (messages) => this.trimPiContext(systemPrompt, messages, provider),
        toolExecution: "sequential",
        beforeToolCall: (toolContext, signal) =>
          this.beforeToolCall(runtimeState, toolContext, signal),
        afterToolCall: (toolContext, signal) =>
          this.afterToolCall(runtimeState, toolContext, signal),
        shouldStopAfterTurn: (turnContext) =>
          this.shouldStopAfterTurn(input, context, runtimeState, turnContext.message, emitEvent),
        getSteeringMessages: async () => [],
        getFollowUpMessages: async () => {
          const followUps = runtimeState.pendingFollowUps;
          runtimeState.pendingFollowUps = [];
          return followUps;
        },
      };

      try {
        await runAgentLoopContinue(
          piContext,
          config,
          async (event) => {
            await this.handlePiEvent(input, runtimeState, event, emitEvent, apiKey);
          },
          abort.signal,
          streamFn,
        );
      } finally {
        abort.cleanup();
      }
    } catch (error) {
      emitEvent({
        type: "runtime.error",
        sessionId: input.sessionId,
        turnId: input.turnId,
        message: redactSecret(error instanceof Error ? error.message : String(error), apiKey),
        stopReason: "unrecoverable-error",
      });
    }
  }

  private trimPiContext(
    systemPrompt: string,
    messages: AgentMessage[],
    provider: ModelProvider,
  ): AgentMessage[] {
    try {
      const budgetTokens = Math.floor(provider.capabilities.contextWindowTokens * CONTEXT_BUDGET_RATIO);
      const chatMessages: ChatMessage[] = [
        ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
        ...messages.filter(isPiMessage).map(piMessageToChatMessage),
      ];
      const trimmed = trimMessagesToContext(chatMessages, budgetTokens);
      return trimmed
        .filter(isNonSystemChatMessage)
        .map(toPiMessage);
    } catch {
      return messages;
    }
  }

  private createStreamFn(
    runtimeState: PiRuntimeState,
    emitEvent: (event: AgentEvent) => void,
  ): StreamFn {
    return (_model, piContext, options) => {
      const stream = createAssistantMessageEventStream();
      void this.streamModelResponse(runtimeState, piContext, stream, emitEvent, options?.signal);
      return stream;
    };
  }

  private async streamModelResponse(
    runtimeState: PiRuntimeState,
    piContext: PiContext,
    stream: AssistantMessageEventStream,
    emitEvent: (event: AgentEvent) => void,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const stopReason = getStopReason({
      externalSignal: signal,
      timeLimitReached: runtimeState.timeLimitReached(),
      elapsedMs: this.now() - runtimeState.startedAt,
      maxDurationMs: runtimeState.maxDurationMs,
      steps: runtimeState.steps,
      maxSteps: runtimeState.maxSteps,
    });
    if (stopReason) {
      runtimeState.pendingStopReason = stopReason;
      pushPiError(stream, createAssistantMessage(runtimeState, {
        content: [],
        stopReason: stopReason === "user-stopped" ? "aborted" : "error",
        errorMessage: stopReason,
      }));
      return;
    }

    const windowTokens = runtimeState.provider.capabilities.contextWindowTokens;
    const budgetTokens = Math.floor(windowTokens * CONTEXT_BUDGET_RATIO);
    const request = createChatRequest(piContext);
    emitEvent({
      type: "context.usage",
      sessionId: runtimeState.sessionId,
      turnId: runtimeState.turnId,
      usedTokens: estimateRequestTokens(request),
      budgetTokens,
      windowTokens,
      source: "estimate",
    });
    this.emitModelRequest(runtimeState, request, emitEvent);

    try {
      if (runtimeState.responseMode !== "smooth" && runtimeState.provider.streamChat) {
        const response = await this.streamProviderResponse(
          runtimeState,
          request,
          stream,
          signal,
          emitEvent,
        );
        if (response.usage) {
          runtimeState.lastProviderUsedTokens = response.usage.promptTokens;
          emitEvent({
            type: "context.usage",
            sessionId: runtimeState.sessionId,
            turnId: runtimeState.turnId,
            usedTokens: response.usage.promptTokens,
            budgetTokens,
            windowTokens,
            source: "provider",
          });
        }
        return;
      }
      const response = await this.requestModelResponse(runtimeState, request, signal, emitEvent);
      if (response.usage) {
        runtimeState.lastProviderUsedTokens = response.usage.promptTokens;
        emitEvent({
          type: "context.usage",
          sessionId: runtimeState.sessionId,
          turnId: runtimeState.turnId,
          usedTokens: response.usage.promptTokens,
          budgetTokens,
          windowTokens,
          source: "provider",
        });
      }
      pushPiResponse(stream, runtimeState, response);
    } catch (error) {
      const aborted = signal?.aborted;
      runtimeState.pendingStopReason = aborted
        ? runtimeState.timeLimitReached()
          ? "time-limit"
          : "user-stopped"
        : "unrecoverable-error";
      pushPiError(stream, createAssistantMessage(runtimeState, {
        content: [{ type: "text", text: "" }],
        stopReason: aborted ? "aborted" : "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private async streamProviderResponse(
    runtimeState: PiRuntimeState,
    request: ChatRequest,
    stream: AssistantMessageEventStream,
    signal: AbortSignal | undefined,
    emitEvent: (event: AgentEvent) => void,
  ): Promise<ChatResponse> {
    runtimeState.deliveryMode = "live";
    let finalResponse: ChatResponse | undefined;
    let emittedLiveContent = false;
    let started = false;
    let textIndex: number | undefined;
    let reasoningIndex: number | undefined;
    let text = "";
    let reasoning = "";
    const toolCalls: ToolCall[] = [];
    const emittedToolCallIds = new Set<string>();
    const partialContent: AssistantMessage["content"] = [];

    const ensureStarted = () => {
      if (!started) {
        started = true;
        stream.push({
          type: "start",
          partial: createAssistantMessage(runtimeState, { content: [] }),
        });
      }
    };

    try {
      const providerStream = runtimeState.provider.streamChat?.(request, signal ? { signal } : undefined) ?? [];
      for await (const event of providerStream) {
        if (event.type === "content.delta") {
          ensureStarted();
          emittedLiveContent = true;
          if (textIndex === undefined) {
            textIndex = partialContent.length;
            partialContent.push({ type: "text", text: "" });
            stream.push({
              type: "text_start",
              contentIndex: textIndex,
              partial: createAssistantMessage(runtimeState, { content: [...partialContent] }),
            });
          }
          text += event.content;
          partialContent[textIndex] = { type: "text", text };
          stream.push({
            type: "text_delta",
            contentIndex: textIndex,
            delta: event.content,
            partial: createAssistantMessage(runtimeState, { content: [...partialContent] }),
          });
        } else if (event.type === "reasoning.delta") {
          ensureStarted();
          if (reasoningIndex === undefined) {
            reasoningIndex = partialContent.length;
            partialContent.push({ type: "thinking", thinking: "" });
            stream.push({
              type: "thinking_start",
              contentIndex: reasoningIndex,
              partial: createAssistantMessage(runtimeState, { content: [...partialContent] }),
            });
          }
          reasoning += event.content;
          partialContent[reasoningIndex] = { type: "thinking", thinking: reasoning };
          stream.push({
            type: "thinking_delta",
            contentIndex: reasoningIndex,
            delta: event.content,
            partial: createAssistantMessage(runtimeState, { content: [...partialContent] }),
          });
        } else if (event.type === "tool.call") {
          ensureStarted();
          const piToolCall = storyForgeToolCallToPiToolCall(event.toolCall);
          toolCalls.push(event.toolCall);
          emittedToolCallIds.add(event.toolCall.id);
          const contentIndex = partialContent.length;
          partialContent.push(piToolCall);
          stream.push({
            type: "toolcall_end",
            contentIndex,
            toolCall: piToolCall,
            partial: createAssistantMessage(runtimeState, { content: [...partialContent] }),
          });
        } else if (event.type === "done") {
          finalResponse = event.response;
        }
      }
    } catch (error) {
      if (runtimeState.responseMode === "auto" && !emittedLiveContent && !signal?.aborted) {
        emitEvent({
          type: "response.fallback",
          sessionId: runtimeState.sessionId,
          turnId: runtimeState.turnId,
          from: "live",
          to: "smooth",
          reason: error instanceof Error ? error.message : String(error),
        });
        runtimeState.deliveryMode = "smooth";
        const response = await runtimeState.provider.chat(request, signal ? { signal } : undefined);
        pushPiResponse(stream, runtimeState, response);
        return response;
      }
      throw error;
    }

    const response = finalResponse ?? {
      content: text,
      ...(reasoning ? { reasoningContent: reasoning } : {}),
      toolCalls,
    };
    if (!started) {
      pushPiResponse(stream, runtimeState, response);
      return response;
    }
    if (reasoningIndex !== undefined) {
      const finalReasoning = response.reasoningContent ?? reasoning;
      partialContent[reasoningIndex] = { type: "thinking", thinking: finalReasoning };
      stream.push({
        type: "thinking_end",
        contentIndex: reasoningIndex,
        content: finalReasoning,
        partial: createAssistantMessage(runtimeState, { content: [...partialContent] }),
      });
    }
    if (textIndex !== undefined) {
      const finalText = response.content || text;
      partialContent[textIndex] = { type: "text", text: finalText };
      stream.push({
        type: "text_end",
        contentIndex: textIndex,
        content: finalText,
        partial: createAssistantMessage(runtimeState, { content: [...partialContent] }),
      });
    }
    for (const toolCall of response.toolCalls) {
      if (emittedToolCallIds.has(toolCall.id)) {
        continue;
      }
      const piToolCall = storyForgeToolCallToPiToolCall(toolCall);
      const contentIndex = partialContent.length;
      partialContent.push(piToolCall);
      stream.push({
        type: "toolcall_end",
        contentIndex,
        toolCall: piToolCall,
        partial: createAssistantMessage(runtimeState, { content: [...partialContent] }),
      });
    }
    stream.push({
      type: "done",
      reason: response.toolCalls.length > 0 ? "toolUse" : "stop",
      message: chatResponseToPiAssistantMessage(runtimeState, response),
    });
    return response;
  }

  private async requestModelResponse(
    runtimeState: PiRuntimeState,
    request: ChatRequest,
    signal: AbortSignal | undefined,
    emitEvent: (event: AgentEvent) => void,
  ): Promise<ChatResponse> {
    if (runtimeState.responseMode === "smooth") {
      runtimeState.deliveryMode = "smooth";
      return runtimeState.provider.chat(request, signal ? { signal } : undefined);
    }
    if (!runtimeState.provider.streamChat) {
      if (runtimeState.responseMode === "live") {
        throw new Error(`Live streaming is not available for ${runtimeState.provider.id}.`);
      }
      runtimeState.deliveryMode = "smooth";
      return runtimeState.provider.chat(request, signal ? { signal } : undefined);
    }

    try {
      runtimeState.deliveryMode = "live";
      return await this.requestStreamingModelResponse(runtimeState, request, signal);
    } catch (error) {
      if (runtimeState.responseMode === "auto" && !signal?.aborted) {
        emitEvent({
          type: "response.fallback",
          sessionId: runtimeState.sessionId,
          turnId: runtimeState.turnId,
          from: "live",
          to: "smooth",
          reason: error instanceof Error ? error.message : String(error),
        });
        runtimeState.deliveryMode = "smooth";
        return runtimeState.provider.chat(request, signal ? { signal } : undefined);
      }
      throw error;
    }
  }

  private async requestStreamingModelResponse(
    runtimeState: PiRuntimeState,
    request: ChatRequest,
    signal: AbortSignal | undefined,
  ): Promise<ChatResponse> {
    let finalResponse: ChatResponse | undefined;
    const contentParts: string[] = [];
    const reasoningParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    const stream = runtimeState.provider.streamChat?.(request, signal ? { signal } : undefined) ?? [];
    for await (const event of stream) {
      if (event.type === "content.delta") {
        contentParts.push(event.content);
      } else if (event.type === "reasoning.delta") {
        reasoningParts.push(event.content);
      } else if (event.type === "tool.call") {
        toolCalls.push(event.toolCall);
      } else if (event.type === "done") {
        finalResponse = event.response;
      }
    }
    if (finalResponse) {
      return finalResponse;
    }
    if (contentParts.length > 0 || reasoningParts.length > 0 || toolCalls.length > 0) {
      return {
        content: contentParts.join(""),
        ...(reasoningParts.length ? { reasoningContent: reasoningParts.join("") } : {}),
        toolCalls,
      };
    }
    throw new Error("Streaming response ended before a final response was received");
  }

  private emitModelRequest(
    runtimeState: PiRuntimeState,
    request: ChatRequest,
    emitEvent: (event: AgentEvent) => void,
  ): void {
    if (!runtimeState.developerMode) {
      return;
    }
    emitEvent({
      type: "model.request",
      sessionId: runtimeState.sessionId,
      turnId: runtimeState.turnId,
      requestId: `model-request-${runtimeState.nextModelRequestIndex++}`,
      providerId: runtimeState.providerId,
      model: runtimeState.model,
      responseMode: runtimeState.responseMode,
      messages: request.messages.map(toInspectableMessage),
      tools: (request.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    });
  }

  private async beforeToolCall(
    runtimeState: PiRuntimeState,
    context: BeforeToolCallContext,
    signal: AbortSignal | undefined,
  ): Promise<BeforeToolCallResult | undefined> {
    if (runtimeState.pendingStopReason) {
      return { block: true, reason: `Tool execution skipped: ${runtimeState.pendingStopReason}` };
    }
    const stopReason = getStopReason({
      externalSignal: signal,
      timeLimitReached: runtimeState.timeLimitReached(),
      elapsedMs: this.now() - runtimeState.startedAt,
      maxDurationMs: runtimeState.maxDurationMs,
      steps: runtimeState.steps,
      maxSteps: runtimeState.maxSteps,
    });
    if (stopReason) {
      runtimeState.pendingStopReason = stopReason;
      return { block: true, reason: `Tool execution skipped: ${stopReason}` };
    }

    const toolCall = piToolCallToStoryForgeToolCall(context.toolCall);
    const signature = createToolSignature(toolCall);
    if (signature === runtimeState.previousToolSignature) {
      runtimeState.repeatedToolCalls += 1;
    } else {
      runtimeState.previousToolSignature = signature;
      runtimeState.repeatedToolCalls = 1;
    }
    if (runtimeState.repeatedToolCalls >= MAX_REPEATED_TOOL_CALLS) {
      runtimeState.pendingStopReason = "repeated-tool-call";
      return { block: true, reason: "Tool execution skipped: repeated-tool-call" };
    }
    return undefined;
  }

  private async afterToolCall(
    runtimeState: PiRuntimeState,
    context: AfterToolCallContext,
    _signal: AbortSignal | undefined,
  ): Promise<AfterToolCallResult | undefined> {
    runtimeState.consecutiveToolFailures = context.isError
      ? runtimeState.consecutiveToolFailures + 1
      : 0;
    if (runtimeState.consecutiveToolFailures >= MAX_CONSECUTIVE_TOOL_FAILURES) {
      runtimeState.pendingStopReason = "consecutive-tool-failures";
      return { terminate: true };
    }
    return undefined;
  }

  private async shouldStopAfterTurn(
    input: AgentRuntimeTurnInput,
    context: Awaited<ReturnType<RuntimeContextAssembler["build"]>>,
    runtimeState: PiRuntimeState,
    message: AgentMessage,
    emitEvent: (event: AgentEvent) => void,
  ): Promise<boolean> {
    if (runtimeState.pendingStopReason) {
      return true;
    }
    if (isPiAssistantMessage(message) && message.stopReason === "aborted") {
      runtimeState.pendingStopReason = input.signal?.aborted
        ? "user-stopped"
        : runtimeState.timeLimitReached()
          ? "time-limit"
          : "unrecoverable-error";
      return true;
    }
    if (isPiAssistantMessage(message) && message.stopReason === "error") {
      runtimeState.pendingStopReason = "unrecoverable-error";
      return true;
    }
    const toolCalls = isPiAssistantMessage(message)
      ? message.content.filter((content): content is PiToolCall => content.type === "toolCall")
      : [];
    if (toolCalls.length > 0) {
      return false;
    }

    const tasks = await this.listTasks(input.sessionId, context);
    const openTasks = tasks.filter((task) =>
      task.status === "pending" || task.status === "in_progress"
    );
    if (openTasks.length === 0) {
      return true;
    }
    emitEvent({
      type: "task.list.updated",
      sessionId: input.sessionId,
      turnId: input.turnId,
      tasks,
      reason: "guard",
    });
    if (runtimeState.unfinishedTaskGuardReminders >= MAX_UNFINISHED_TASK_GUARD_REMINDERS) {
      runtimeState.pendingStopReason = "unfinished-tasks";
      return true;
    }
    runtimeState.unfinishedTaskGuardReminders += 1;
    runtimeState.pendingFollowUps.push({
      role: "user",
      content: UNFINISHED_TASK_REMINDER,
      timestamp: Date.now(),
    });
    return false;
  }

  private async handlePiEvent(
    input: AgentRuntimeTurnInput,
    runtimeState: PiRuntimeState,
    event: PiAgentEvent,
    emitEvent: (event: AgentEvent) => void,
    apiKey: string | undefined,
  ): Promise<void> {
    if (event.type === "agent_start") {
      emitEvent({
        type: "runtime.started",
        sessionId: input.sessionId,
        turnId: input.turnId,
        createdAt: new Date().toISOString(),
      });
      return;
    }
    if (event.type === "turn_start") {
      runtimeState.steps += 1;
      return;
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      if (event.assistantMessageEvent.delta) {
        emitEvent({
          type: "message.delta",
          sessionId: input.sessionId,
          turnId: input.turnId,
          content: event.assistantMessageEvent.delta,
          delivery: runtimeState.deliveryMode,
        });
      }
      return;
    }
    if (event.type === "tool_execution_start") {
      runtimeState.steps += 1;
      emitEvent({
        type: "tool.call",
        sessionId: input.sessionId,
        turnId: input.turnId,
        callId: event.toolCallId,
        name: event.toolName,
        input: event.args,
      });
      return;
    }
    if (event.type === "tool_execution_end") {
      runtimeState.toolResults.set(event.toolCallId, !event.isError);
      emitEvent({
        type: "tool.result",
        sessionId: input.sessionId,
        turnId: input.turnId,
        callId: event.toolCallId,
        name: event.toolName,
        ok: !event.isError,
        output: extractToolResultOutput(event.result, event.isError),
      });
      return;
    }
    if (event.type === "turn_end") {
      await this.checkpoint(input.sessionId, runtimeState);
      return;
    }
    if (event.type === "agent_end") {
      const stopReason = runtimeState.pendingStopReason ?? "completed";
      if (stopReason === "unrecoverable-error") {
        emitEvent({
          type: "runtime.error",
          sessionId: input.sessionId,
          turnId: input.turnId,
          message: redactSecret(findPiErrorMessage(runtimeState.piMessages) ?? "PI Agent runtime failed", apiKey),
          stopReason,
          steps: runtimeState.steps,
        });
        return;
      }
      emitEvent({
        type: "runtime.completed",
        sessionId: input.sessionId,
        turnId: input.turnId,
        stopReason,
        steps: runtimeState.steps,
      });
    }
  }

  private async checkpoint(
    sessionId: SessionId,
    runtimeState: PiRuntimeState,
  ): Promise<void> {
    const chatMessages: ChatMessage[] = runtimeState.piMessages
      .filter(isPiMessage)
      .map(piMessageToChatMessage);
    const nextMessages = toRuntimePersistedMessages(
      chatMessages,
      runtimeState.persistedMessages,
      runtimeState.toolResults,
    );
    const updated = await this.replaceMessages(sessionId, nextMessages);
    runtimeState.persistedMessages = updated.messages;
  }

  private async replaceMessages(
    sessionId: SessionId,
    messages: RuntimeSession["messages"],
  ): Promise<RuntimeSession> {
    if (!this.sessionStore.replaceMessages) {
      throw new Error("PiAgentRuntime requires a session store with replaceMessages");
    }
    return this.sessionStore.replaceMessages(sessionId, messages);
  }

  private async listTasks(
    sessionId: SessionId,
    context: Awaited<ReturnType<RuntimeContextAssembler["build"]>>,
  ) {
    return this.sessionStore.listTasks
      ? this.sessionStore.listTasks(sessionId)
      : context.tasks;
  }
}

function createPiTools(tools: ToolRegistry, signal: AbortSignal): AgentTool[] {
  return tools.list().map((tool) => ({
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters as AgentTool["parameters"],
    executionMode: "sequential" as const,
    execute: async (_toolCallId, params) => {
      const input = isRecord(params) ? params : {};
      const result = await tools.execute(tool.name, input, { signal });
      if (!result.ok) {
        throw new Error(result.error);
      }
      return {
        content: [{ type: "text", text: serializeToolOutput(result.output) }],
        details: result.output,
      };
    },
  }));
}

function createPiModel(input: {
  providerId: ProviderConnectionConfig["providerId"];
  model: string;
  resolvedProvider: ProviderConnectionConfig;
  provider: ModelProvider;
}): Model<Api> {
  return {
    id: input.model,
    name: input.model,
    api: "openai-completions",
    provider: input.providerId,
    baseUrl: input.resolvedProvider.baseUrl,
    reasoning: false,
    input: ["text", "image"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: input.provider.capabilities.contextWindowTokens,
    maxTokens: Math.min(8192, input.provider.capabilities.contextWindowTokens),
  };
}

function createChatRequest(piContext: PiContext): ChatRequest {
  const messages: ChatMessage[] = [
    ...(piContext.systemPrompt ? [{ role: "system" as const, content: piContext.systemPrompt }] : []),
    ...piContext.messages.map(piMessageToChatMessage),
  ];
  return {
    messages,
    tools: (piContext.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    })),
  };
}

function pushPiResponse(
  stream: AssistantMessageEventStream,
  runtimeState: PiRuntimeState,
  response: ChatResponse,
): void {
  const finalMessage = chatResponseToPiAssistantMessage(runtimeState, response);
  stream.push({ type: "start", partial: createAssistantMessage(runtimeState, { content: [] }) });
  let contentIndex = 0;
  const partialContent: AssistantMessage["content"] = [];
  if (response.reasoningContent) {
    partialContent.push({ type: "thinking", thinking: "" });
    stream.push({
      type: "thinking_start",
      contentIndex,
      partial: createAssistantMessage(runtimeState, { content: [...partialContent] }),
    });
    partialContent[contentIndex] = { type: "thinking", thinking: response.reasoningContent };
    stream.push({
      type: "thinking_delta",
      contentIndex,
      delta: response.reasoningContent,
      partial: createAssistantMessage(runtimeState, { content: [...partialContent] }),
    });
    stream.push({
      type: "thinking_end",
      contentIndex,
      content: response.reasoningContent,
      partial: createAssistantMessage(runtimeState, { content: [...partialContent] }),
    });
    contentIndex += 1;
  }
  if (response.content) {
    partialContent.push({ type: "text", text: "" });
    stream.push({
      type: "text_start",
      contentIndex,
      partial: createAssistantMessage(runtimeState, { content: [...partialContent] }),
    });
    partialContent[contentIndex] = { type: "text", text: response.content };
    stream.push({
      type: "text_delta",
      contentIndex,
      delta: response.content,
      partial: createAssistantMessage(runtimeState, { content: [...partialContent] }),
    });
    stream.push({
      type: "text_end",
      contentIndex,
      content: response.content,
      partial: createAssistantMessage(runtimeState, { content: [...partialContent] }),
    });
    contentIndex += 1;
  }
  for (const toolCall of response.toolCalls) {
    const piToolCall = storyForgeToolCallToPiToolCall(toolCall);
    partialContent.push(piToolCall);
    stream.push({
      type: "toolcall_end",
      contentIndex,
      toolCall: piToolCall,
      partial: createAssistantMessage(runtimeState, { content: [...partialContent] }),
    });
    contentIndex += 1;
  }
  stream.push({
    type: "done",
    reason: response.toolCalls.length > 0 ? "toolUse" : "stop",
    message: finalMessage,
  });
}

function pushPiError(stream: AssistantMessageEventStream, error: AssistantMessage): void {
  stream.push({ type: "start", partial: error });
  stream.push({ type: "error", reason: error.stopReason === "aborted" ? "aborted" : "error", error });
}

function chatResponseToPiAssistantMessage(
  runtimeState: PiRuntimeState,
  response: ChatResponse,
): AssistantMessage {
  const content: AssistantMessage["content"] = [
    ...(response.reasoningContent
      ? [{ type: "thinking" as const, thinking: response.reasoningContent }]
      : []),
    ...(response.content ? [{ type: "text" as const, text: response.content }] : []),
    ...response.toolCalls.map(storyForgeToolCallToPiToolCall),
  ];
  return createAssistantMessage(runtimeState, {
    content,
    ...(response.usage ? { usage: usageToPiUsage(response.usage) } : {}),
    stopReason: response.toolCalls.length > 0 ? "toolUse" : "stop",
  });
}

function createAssistantMessage(
  runtimeState: PiRuntimeState,
  input: {
    content: AssistantMessage["content"];
    usage?: Usage;
    stopReason?: AssistantMessage["stopReason"];
    errorMessage?: string;
  },
): AssistantMessage {
  return {
    role: "assistant",
    content: input.content,
    api: "openai-completions",
    provider: runtimeState.providerId,
    model: runtimeState.model,
    usage: input.usage ?? EMPTY_USAGE,
    stopReason: input.stopReason ?? "stop",
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    timestamp: Date.now(),
  };
}

type NonSystemChatMessage = Exclude<ChatMessage, { role: "system" }>;

function toPiMessage(message: NonSystemChatMessage): PiMessage {
  if (message.role === "user") {
    return {
      role: "user",
      content: typeof message.content === "string"
        ? message.content
        : message.content.map((part): TextContent | ImageContent =>
          part.type === "text"
            ? { type: "text", text: part.text }
            : { type: "image", data: part.data, mimeType: part.mediaType }
        ),
      timestamp: Date.now(),
    };
  }
  if (message.role === "tool") {
    return {
      role: "toolResult",
      toolCallId: message.toolCallId,
      toolName: message.name,
      content: [{ type: "text", text: message.content }],
      isError: false,
      timestamp: Date.now(),
    };
  }
  const content: AssistantMessage["content"] = [
    ...(message.reasoningContent
      ? [{ type: "thinking" as const, thinking: message.reasoningContent }]
      : []),
    ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
    ...(message.toolCalls ?? []).map(storyForgeToolCallToPiToolCall),
  ];
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "deepseek",
    model: "unknown",
    usage: EMPTY_USAGE,
    stopReason: message.toolCalls?.length ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
}

function isNonSystemChatMessage(message: ChatMessage): message is NonSystemChatMessage {
  return message.role !== "system";
}

function piMessageToChatMessage(message: PiMessage): ChatMessage {
  if (message.role === "user") {
    return {
      role: "user",
      content: typeof message.content === "string"
        ? message.content
        : message.content.map((part) =>
          part.type === "text"
            ? { type: "text" as const, text: part.text }
            : { type: "image" as const, data: part.data, mediaType: part.mimeType }
        ),
    };
  }
  if (message.role === "toolResult") {
    return {
      role: "tool",
      name: message.toolName,
      toolCallId: message.toolCallId,
      content: contentToText(message.content),
    };
  }
  const text = message.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");
  const reasoningContent = message.content
    .filter((part) => part.type === "thinking")
    .map((part) => part.thinking)
    .join("");
  const toolCalls = message.content
    .filter((part): part is PiToolCall => part.type === "toolCall")
    .map(piToolCallToStoryForgeToolCall);
  return {
    role: "assistant",
    content: text,
    ...(reasoningContent ? { reasoningContent } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
  };
}

function storyForgeToolCallToPiToolCall(toolCall: ToolCall): PiToolCall {
  return {
    type: "toolCall",
    id: toolCall.id,
    name: toolCall.name,
    arguments: toolCall.input,
  };
}

function piToolCallToStoryForgeToolCall(toolCall: PiToolCall): ToolCall {
  return {
    id: toolCall.id,
    name: toolCall.name,
    input: toolCall.arguments,
  };
}

function usageToPiUsage(usage: NonNullable<ChatResponse["usage"]>): Usage {
  return {
    input: usage.promptTokens,
    output: usage.completionTokens ?? 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: usage.totalTokens ?? usage.promptTokens + (usage.completionTokens ?? 0),
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function extractToolResultOutput(result: unknown, isError: boolean): unknown {
  if (!isAgentToolResult(result)) {
    return result;
  }
  if (isError) {
    return contentToText(result.content);
  }
  return result.details ?? contentToText(result.content);
}

function isAgentToolResult(value: unknown): value is AgentToolResult<unknown> {
  return isRecord(value) && Array.isArray(value.content);
}

function contentToText(content: Array<TextContent | ImageContent>): string {
  return content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function isPiMessage(message: AgentMessage): message is PiMessage {
  return isRecord(message) &&
    (message.role === "user" || message.role === "assistant" || message.role === "toolResult");
}

function isPiAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return isRecord(message) && message.role === "assistant";
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

function estimateRequestTokens(request: ChatRequest): number {
  const toolTokens = request.tools?.length
    ? Math.ceil(JSON.stringify(request.tools).length / 4)
    : 0;
  return estimateMessagesTokens(request.messages) + toolTokens;
}

function toInspectableMessage(message: ChatMessage): InspectableModelMessage {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.reasoningContent === undefined
        ? {}
        : { reasoningContent: message.reasoningContent }),
      ...(message.toolCalls === undefined
        ? {}
        : {
            toolCalls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.input,
            })),
          }),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      name: message.name,
      toolCallId: message.toolCallId,
    };
  }
  if (message.role === "system") {
    return {
      role: "system",
      content: message.content,
    };
  }
  return {
    role: "user",
    content: message.content,
  };
}

function findPiErrorMessage(messages: AgentMessage[]): string | undefined {
  const lastAssistant = [...messages].reverse().find(isPiAssistantMessage);
  return lastAssistant?.errorMessage;
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
        controller.abort(new Error("PI Agent runtime time limit reached"));
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

function createEventQueue() {
  const events: AgentEvent[] = [];
  let closed = false;
  let waiter: (() => void) | undefined;

  const wake = () => {
    waiter?.();
    waiter = undefined;
  };

  return {
    push: (event: AgentEvent) => {
      events.push(event);
      wake();
    },
    close: () => {
      closed = true;
      wake();
    },
    next: async (): Promise<IteratorResult<AgentEvent>> => {
      while (events.length === 0 && !closed) {
        await new Promise<void>((resolve) => {
          waiter = resolve;
        });
      }
      const event = events.shift();
      return event ? { done: false, value: event } : { done: true, value: undefined };
    },
  };
}

function redactEvent(event: AgentEvent, secret: string | undefined): AgentEvent {
  if (event.type !== "runtime.error") {
    return event;
  }
  return {
    ...event,
    message: redactSecret(event.message, secret),
  };
}

function redactSecret(message: string, secret: string | undefined): string {
  return secret ? message.split(secret).join("[REDACTED]") : message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
