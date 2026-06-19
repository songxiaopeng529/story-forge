import { AgentLoop } from "@story-forge/agent-core";
import type {
  ChatMessage,
  ModelProvider,
  ProviderConnectionConfig,
  ToolCall,
} from "@story-forge/model-gateway";
import {
  createTurnId,
  type AgentEvent,
  type AgentStopReason,
  type ResponseMode,
  type SessionId,
  type TurnId,
} from "@story-forge/shared";
import {
  createWorkspaceCommandTool,
  createWorkspaceFileTools,
  ToolRegistry,
  WorkspaceSandbox,
} from "@story-forge/tools";
import type { ProviderConfigStore } from "./provider-config-store";
import {
  type PersistedMessage,
  type SessionRecord,
  type SessionRepository,
  type SessionStatus,
} from "./session-repository";
import type { WorkspaceRepository } from "./workspace-repository";

export type ProviderFactory = {
  createProvider(config: ProviderConnectionConfig, apiKey: string): ModelProvider;
};

export type AgentCoordinatorOptions = {
  providerStore: ProviderConfigStore;
  sessionRepository: SessionRepository;
  workspaceRepository: WorkspaceRepository;
  providerFactory: ProviderFactory;
  getResponseMode?: () => Promise<ResponseMode>;
  getDeveloperMode?: () => Promise<boolean>;
  emit: (event: AgentEvent) => void;
  maxSteps?: number;
  maxDurationMs?: number;
};

type ActiveTurn = {
  sessionId: SessionId;
  controller: AbortController;
};

export class AgentCoordinator {
  private readonly providerStore: ProviderConfigStore;
  private readonly sessionRepository: SessionRepository;
  private readonly workspaceRepository: WorkspaceRepository;
  private readonly providerFactory: ProviderFactory;
  private readonly getResponseMode: () => Promise<ResponseMode>;
  private readonly getDeveloperMode: () => Promise<boolean>;
  private readonly emitEvent: (event: AgentEvent) => void;
  private readonly maxSteps: number | undefined;
  private readonly maxDurationMs: number | undefined;
  private readonly activeTurns = new Map<TurnId, ActiveTurn>();
  private readonly reservedSessions = new Set<SessionId>();
  private readonly turnPromises = new Map<TurnId, Promise<void>>();

  constructor(options: AgentCoordinatorOptions) {
    this.providerStore = options.providerStore;
    this.sessionRepository = options.sessionRepository;
    this.workspaceRepository = options.workspaceRepository;
    this.providerFactory = options.providerFactory;
    this.getResponseMode = options.getResponseMode ?? (async () => "auto");
    this.getDeveloperMode = options.getDeveloperMode ?? (async () => false);
    this.emitEvent = options.emit;
    this.maxSteps = options.maxSteps;
    this.maxDurationMs = options.maxDurationMs;
  }

  async start(input: { sessionId: SessionId; prompt: string }): Promise<{ turnId: TurnId }> {
    if (!input.prompt.trim()) {
      throw new Error("Prompt must not be empty");
    }
    if (this.reservedSessions.has(input.sessionId)) {
      throw new Error(`Session already has an active turn: ${input.sessionId}`);
    }
    this.reservedSessions.add(input.sessionId);

    try {
      let session = await this.sessionRepository.get(input.sessionId);
      const turnId = createTurnId();
      session = await this.sessionRepository.appendMessage(input.sessionId, {
        id: createMessageId(),
        role: "user",
        content: input.prompt,
        createdAt: new Date().toISOString(),
      });
      await this.sessionRepository.markStatus(input.sessionId, {
        status: "running",
        turnId,
      });

      const controller = new AbortController();
      this.activeTurns.set(turnId, { sessionId: input.sessionId, controller });
      const promise = this.executeTurn(session, turnId, controller.signal)
        .finally(() => {
          this.activeTurns.delete(turnId);
          this.reservedSessions.delete(input.sessionId);
          const cleanup = setTimeout(() => {
            this.turnPromises.delete(turnId);
          }, 60_000);
          cleanup.unref?.();
        });
      this.turnPromises.set(turnId, promise);
      void promise.catch(() => undefined);
      return { turnId };
    } catch (error) {
      this.reservedSessions.delete(input.sessionId);
      throw error;
    }
  }

  async stop(turnId: TurnId): Promise<void> {
    this.activeTurns.get(turnId)?.controller.abort();
  }

  async waitForTurn(turnId: TurnId): Promise<void> {
    const promise = this.turnPromises.get(turnId);
    if (!promise) {
      return;
    }
    try {
      await promise;
    } finally {
      this.turnPromises.delete(turnId);
    }
  }

  private async executeTurn(
    session: SessionRecord,
    turnId: TurnId,
    signal: AbortSignal,
  ): Promise<void> {
    let apiKey: string | undefined;
    try {
      const [resolvedProvider, workspace] = await Promise.all([
        this.providerStore.resolve(session.providerId),
        this.workspaceRepository.get(session.workspaceId),
      ]);
      apiKey = resolvedProvider.apiKey;
      const provider = this.providerFactory.createProvider(
        {
          providerId: session.providerId,
          baseUrl: resolvedProvider.baseUrl,
          model: session.model,
        },
        resolvedProvider.apiKey,
      );
      const sandbox = new WorkspaceSandbox(workspace.path);
      const tools = new ToolRegistry([
        ...createWorkspaceFileTools(sandbox),
        createWorkspaceCommandTool(sandbox),
      ]);
      let persistedMessages = session.messages;
      const toolResults = new Map<string, boolean>();
      const loop = new AgentLoop({
        provider,
        tools,
        ...(this.maxSteps === undefined ? {} : { maxSteps: this.maxSteps }),
        ...(this.maxDurationMs === undefined ? {} : { maxDurationMs: this.maxDurationMs }),
      });
      const [responseMode, developerMode] = await Promise.all([
        this.getResponseMode(),
        this.getDeveloperMode(),
      ]);
      const result = await loop.run({
        sessionId: session.id,
        turnId,
        responseMode,
        inspectModelRequests: {
          enabled: developerMode,
          providerId: session.providerId,
          model: session.model,
        },
        signal,
        messages: [
          {
            role: "system",
            content:
              `You are StoryForge, a local coding agent working in ${workspace.path}. `
              + "Inspect before editing, use workspace-relative paths, and run only necessary development commands.",
          },
          ...persistedMessages.map(toChatMessage),
        ],
        onEvent: (event) => {
          if (event.type === "tool.result") {
            toolResults.set(event.callId, event.ok);
          }
          this.emitEvent(
            event.type === "runtime.error"
              ? { ...event, message: redactSecret(event.message, apiKey) }
              : event,
          );
        },
        onCheckpoint: async (messages) => {
          const nextMessages = toPersistedMessages(messages, persistedMessages, toolResults);
          const updated = await this.sessionRepository.replaceMessages(session.id, nextMessages);
          persistedMessages = updated.messages;
        },
      });
      await this.sessionRepository.markStatus(session.id, {
        status: statusForStopReason(result.stopReason),
        stopReason: result.stopReason,
      });
    } catch (error) {
      const message = redactSecret(
        error instanceof Error ? error.message : String(error),
        apiKey,
      );
      this.emitEvent({
        type: "runtime.error",
        sessionId: session.id,
        turnId,
        message,
        stopReason: "unrecoverable-error",
      });
      await this.sessionRepository.markStatus(session.id, {
        status: "error",
        stopReason: "unrecoverable-error",
      });
    }
  }
}

function toChatMessage(message: PersistedMessage): ChatMessage {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.reasoningContent ? { reasoningContent: message.reasoningContent } : {}),
      ...(message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}),
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
  return { role: "user", content: message.content };
}

function toPersistedMessages(
  messages: ChatMessage[],
  previous: PersistedMessage[],
  toolResults: Map<string, boolean>,
): PersistedMessage[] {
  return messages
    .filter((message) => message.role !== "system")
    .map((message, index) => {
      const existing = previous[index];
      const identity = {
        id: existing?.id ?? createMessageId(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      if (message.role === "assistant") {
        return {
          ...identity,
          role: "assistant" as const,
          content: message.content,
          ...(message.reasoningContent ? { reasoningContent: message.reasoningContent } : {}),
          ...(message.toolCalls?.length
            ? { toolCalls: cloneToolCalls(message.toolCalls) }
            : {}),
        };
      }
      if (message.role === "tool") {
        const existingOk = existing?.role === "tool" ? existing.ok : undefined;
        return {
          ...identity,
          role: "tool" as const,
          content: message.content,
          name: message.name,
          toolCallId: message.toolCallId,
          ok: toolResults.get(message.toolCallId) ?? existingOk ?? false,
        };
      }
      return {
        ...identity,
        role: "user" as const,
        content: message.content,
      };
    });
}

function cloneToolCalls(toolCalls: ToolCall[]): ToolCall[] {
  return toolCalls.map((toolCall) => ({
    ...toolCall,
    input: { ...toolCall.input },
  }));
}

function statusForStopReason(stopReason: AgentStopReason): SessionStatus {
  if (stopReason === "completed") {
    return "completed";
  }
  if (stopReason === "unrecoverable-error") {
    return "error";
  }
  return "stopped";
}

function createMessageId(): string {
  return `sf_message_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function redactSecret(message: string, secret: string | undefined): string {
  return secret ? message.split(secret).join("[REDACTED]") : message;
}
