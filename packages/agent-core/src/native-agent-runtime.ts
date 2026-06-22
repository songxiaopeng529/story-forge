import type { AgentEvent, SessionId } from "@story-forge/shared";
import type {
  AgentRuntime,
  AgentRuntimeTurnInput,
  RuntimeProviderFactory,
  RuntimeProviderResolver,
  RuntimeSession,
  RuntimeSessionStore,
  RuntimeToolFactory,
} from "./agent-runtime";
import { AgentLoop } from "./agent-loop";
import { RuntimeContextAssembler, toRuntimePersistedMessages } from "./runtime-context";

export type NativeAgentRuntimeOptions = {
  contextAssembler: RuntimeContextAssembler;
  providerResolver: RuntimeProviderResolver;
  providerFactory: RuntimeProviderFactory;
  toolFactory: RuntimeToolFactory;
  sessionStore: Pick<RuntimeSessionStore, "replaceMessages">;
  maxSteps?: number;
  maxDurationMs?: number;
};

export class NativeAgentRuntime implements AgentRuntime {
  private readonly contextAssembler: RuntimeContextAssembler;
  private readonly providerResolver: RuntimeProviderResolver;
  private readonly providerFactory: RuntimeProviderFactory;
  private readonly toolFactory: RuntimeToolFactory;
  private readonly sessionStore: Pick<RuntimeSessionStore, "replaceMessages">;
  private readonly maxSteps: number | undefined;
  private readonly maxDurationMs: number | undefined;

  constructor(options: NativeAgentRuntimeOptions) {
    this.contextAssembler = options.contextAssembler;
    this.providerResolver = options.providerResolver;
    this.providerFactory = options.providerFactory;
    this.toolFactory = options.toolFactory;
    this.sessionStore = options.sessionStore;
    this.maxSteps = options.maxSteps;
    this.maxDurationMs = options.maxDurationMs;
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
      const resolvedProvider = await this.providerResolver.resolve(context.session.providerId);
      apiKey = resolvedProvider.apiKey;
      let persistedMessages = context.session.messages;
      const toolResults = new Map<string, boolean>();
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
      const loop = new AgentLoop({
        provider,
        tools,
        ...(this.maxSteps === undefined ? {} : { maxSteps: this.maxSteps }),
        ...(this.maxDurationMs === undefined ? {} : { maxDurationMs: this.maxDurationMs }),
      });

      await loop.run({
        sessionId: input.sessionId,
        turnId: input.turnId,
        responseMode: context.settings.responseMode,
        inspectModelRequests: {
          enabled: context.settings.developerMode,
          providerId: context.session.providerId,
          model: context.session.model,
        },
        ...(input.signal ? { signal: input.signal } : {}),
        messages: context.messages,
        onEvent: (event) => {
          if (event.type === "tool.result") {
            toolResults.set(event.callId, event.ok);
          }
          emitEvent(redactEvent(event, apiKey));
        },
        onCheckpoint: async (messages) => {
          const nextMessages = toRuntimePersistedMessages(messages, persistedMessages, toolResults);
          const updated = await this.replaceMessages(input.sessionId, nextMessages);
          persistedMessages = updated.messages;
        },
      });
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

  private async replaceMessages(
    sessionId: SessionId,
    messages: RuntimeSession["messages"],
  ): Promise<RuntimeSession> {
    if (!this.sessionStore.replaceMessages) {
      throw new Error("NativeAgentRuntime requires a session store with replaceMessages");
    }
    return this.sessionStore.replaceMessages(sessionId, messages);
  }
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
