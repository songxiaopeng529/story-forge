import { AgentLoop } from "@story-forge/agent-core";
import type {
  ChatMessage,
  ModelProvider,
  ProviderId,
  ProviderConnectionConfig,
  ToolCall,
} from "@story-forge/model-gateway";
import {
  createTurnId,
  type AgentEvent,
  type AgentStopReason,
  type CommandExecutionMode,
  type InstalledSkillRecord,
  type ResponseMode,
  type SessionId,
  type SkillView,
  type TurnId,
} from "@story-forge/shared";
import {
  createAutomationProposalTool,
  createWorkspaceCommandTool,
  createWorkspaceFileTools,
  type AutomationProposalDraft,
  type WorkspaceCommandPermissionRequest,
  ToolRegistry,
  WorkspaceSandbox,
} from "@story-forge/tools";
import { validateSchedule } from "./automation-schedule";
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

export type SkillInvocationResolver = {
  list?(): Promise<SkillView[]>;
  resolveInvocation(command: string): Promise<InstalledSkillRecord | undefined>;
};

export type AgentCoordinatorOptions = {
  providerStore: ProviderConfigStore;
  sessionRepository: SessionRepository;
  workspaceRepository: WorkspaceRepository;
  providerFactory: ProviderFactory;
  skillResolver?: SkillInvocationResolver;
  getResponseMode?: () => Promise<ResponseMode>;
  getDeveloperMode?: () => Promise<boolean>;
  getCommandExecutionMode?: () => Promise<CommandExecutionMode>;
  emit: (event: AgentEvent) => void;
  maxSteps?: number;
  maxDurationMs?: number;
};

type ActiveTurn = {
  sessionId: SessionId;
  controller: AbortController;
};

type ActiveSkillInvocation = {
  skill: InstalledSkillRecord;
  argumentsText: string;
};

const PERMISSION_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export class AgentCoordinator {
  private readonly providerStore: ProviderConfigStore;
  private readonly sessionRepository: SessionRepository;
  private readonly workspaceRepository: WorkspaceRepository;
  private readonly providerFactory: ProviderFactory;
  private readonly skillResolver: SkillInvocationResolver | undefined;
  private readonly getResponseMode: () => Promise<ResponseMode>;
  private readonly getDeveloperMode: () => Promise<boolean>;
  private readonly getCommandExecutionMode: () => Promise<CommandExecutionMode>;
  private readonly emitEvent: (event: AgentEvent) => void;
  private readonly maxSteps: number | undefined;
  private readonly maxDurationMs: number | undefined;
  private readonly activeTurns = new Map<TurnId, ActiveTurn>();
  private readonly pendingPermissions = new Map<string, (approved: boolean) => void>();
  private readonly reservedSessions = new Set<SessionId>();
  private readonly turnPromises = new Map<TurnId, Promise<void>>();

  constructor(options: AgentCoordinatorOptions) {
    this.providerStore = options.providerStore;
    this.sessionRepository = options.sessionRepository;
    this.workspaceRepository = options.workspaceRepository;
    this.providerFactory = options.providerFactory;
    this.skillResolver = options.skillResolver;
    this.getResponseMode = options.getResponseMode ?? (async () => "auto");
    this.getDeveloperMode = options.getDeveloperMode ?? (async () => false);
    this.getCommandExecutionMode = options.getCommandExecutionMode ?? (async () => "sentinel");
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
      const skillInvocation = await this.resolveSkillInvocation(input.prompt);
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
      const promise = this.executeTurn(session, turnId, controller.signal, skillInvocation)
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

  async startAutomationRun(input: {
    workspaceId: string;
    providerId: ProviderId;
    model: string;
    prompt: string;
    title?: string;
  }): Promise<{ sessionId: SessionId; turnId: TurnId }> {
    const session = await this.sessionRepository.create({
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      model: input.model,
      ...(input.title ? { title: input.title } : {}),
    });
    const { turnId } = await this.start({
      sessionId: session.id,
      prompt: input.prompt,
    });
    return { sessionId: session.id, turnId };
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

  respondToPermission(input: { requestId: string; approved: boolean }): void {
    const resolve = this.pendingPermissions.get(input.requestId);
    if (!resolve) {
      return;
    }
    this.pendingPermissions.delete(input.requestId);
    resolve(input.approved);
  }

  private async executeTurn(
    session: SessionRecord,
    turnId: TurnId,
    signal: AbortSignal,
    skillInvocation: ActiveSkillInvocation | undefined,
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
      let persistedMessages = session.messages;
      const toolResults = new Map<string, boolean>();
      const [responseMode, developerMode, commandExecutionMode, availableSkills] = await Promise.all([
        this.getResponseMode(),
        this.getDeveloperMode(),
        this.getCommandExecutionMode(),
        this.listEnabledSkills(),
      ]);
      const tools = new ToolRegistry([
        ...createWorkspaceFileTools(sandbox),
        createWorkspaceCommandTool(sandbox, {
          mode: commandExecutionMode,
          requestPermission: (request) =>
            this.requestCommandPermission({
              sessionId: session.id,
              turnId,
              mode: commandExecutionMode,
              request,
              signal,
            }),
        }),
        createAutomationProposalTool({
          validate: (draft) => validateAutomationProposal(draft),
          emit: (proposal) => {
            const proposalSessionId = proposal.kind === "thread_chat"
              ? session.id
              : undefined;
            this.emitEvent({
              type: "automation.proposal",
              sessionId: session.id,
              turnId,
              proposalId: createAutomationProposalId(),
              proposal: {
                kind: proposal.kind,
                name: proposal.name,
                scheduleText: proposal.scheduleText,
                cron: proposal.cron,
                timezone: proposal.timezone,
                summary: proposal.summary,
                nextRuns: proposal.nextRuns,
                prompt: proposal.prompt,
                workspaceId: workspace.id,
                providerId: session.providerId,
                model: session.model,
                ...(proposalSessionId ? { sessionId: proposalSessionId } : {}),
              },
            });
          },
        }),
      ]);
      const loop = new AgentLoop({
        provider,
        tools,
        ...(this.maxSteps === undefined ? {} : { maxSteps: this.maxSteps }),
        ...(this.maxDurationMs === undefined ? {} : { maxDurationMs: this.maxDurationMs }),
      });
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
              + "Inspect before editing, use workspace-relative paths, and run only necessary development commands. "
              + "If the user asks for recurring or scheduled work, call automation.proposeCreate to draft an automation for user confirmation. "
              + "Use kind=thread_chat only when the user explicitly wants the automation to continue in this same chat with existing context; otherwise use kind=scheduled_chat. "
              + "Never claim the automation is created until the user confirms it.",
          },
          ...(availableSkills.length > 0
            ? [createAvailableSkillsSystemMessage(availableSkills)]
            : []),
          ...(skillInvocation ? [createSkillSystemMessage(skillInvocation)] : []),
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

  private async resolveSkillInvocation(prompt: string): Promise<ActiveSkillInvocation | undefined> {
    const trimmed = prompt.trim();
    const slashInvocation = parseSlashInvocation(trimmed);
    const inferredInvocation = slashInvocation ?? await this.inferMentionedSkillInvocation(trimmed);

    if (!inferredInvocation) {
      return undefined;
    }

    const skill = await this.skillResolver?.resolveInvocation(inferredInvocation.command);
    if (!skill) {
      if (slashInvocation) {
        throw new Error(`Skill not found: ${inferredInvocation.command}`);
      }
      return undefined;
    }
    if (!skill.enabled) {
      if (slashInvocation) {
        throw new Error(`Skill is disabled: ${inferredInvocation.command}`);
      }
      return undefined;
    }
    return {
      skill,
      argumentsText: inferredInvocation.argumentsText,
    };
  }

  private requestCommandPermission(input: {
    sessionId: SessionId;
    turnId: TurnId;
    mode: CommandExecutionMode;
    request: WorkspaceCommandPermissionRequest;
    signal: AbortSignal;
  }): Promise<boolean> {
    const requestId = createPermissionRequestId();

    return new Promise((resolve) => {
      let settled = false;
      const finish = (approved: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        input.signal.removeEventListener("abort", onAbort);
        this.pendingPermissions.delete(requestId);
        resolve(approved);
      };
      const onAbort = () => finish(false);
      const timeout = setTimeout(() => finish(false), PERMISSION_REQUEST_TIMEOUT_MS);
      timeout.unref?.();
      this.pendingPermissions.set(requestId, finish);
      if (input.signal.aborted) {
        finish(false);
        return;
      }
      input.signal.addEventListener("abort", onAbort, { once: true });
      this.emitEvent({
        type: "permission.request",
        sessionId: input.sessionId,
        turnId: input.turnId,
        requestId,
        reason: input.request.reason,
        command: input.request.command,
        mode: input.mode,
        risk: input.request.risk,
      });
    });
  }

  private async inferMentionedSkillInvocation(
    prompt: string,
  ): Promise<{ command: string; argumentsText: string } | undefined> {
    const skills = await this.listEnabledSkills();
    const matches = skills.filter((skill) => promptMentionsSkill(prompt, skill));
    if (matches.length !== 1) {
      return undefined;
    }
    const skill = matches[0];
    if (!skill) {
      return undefined;
    }
    return {
      command: skill.invocationName,
      argumentsText: prompt,
    };
  }

  private async listEnabledSkills(): Promise<SkillView[]> {
    const skills = (await this.skillResolver?.list?.()) ?? [];
    return skills
      .filter((skill) => skill.enabled)
      .sort((left, right) => left.invocationName.localeCompare(right.invocationName));
  }
}

function createAvailableSkillsSystemMessage(skills: SkillView[]): ChatMessage {
  return {
    role: "system",
    content: [
      "Available StoryForge skills:",
      ...skills.map((skill) =>
        `- ${skill.invocationName} (${skill.name}): ${singleLine(skill.description)}`
      ),
      "",
      "These are installed and enabled skills. Do not deny that a listed skill exists just because there is no dedicated tool with the same name.",
      "If the user explicitly invokes or mentions one of these skills, follow the matching active skill instructions when they are provided in this request.",
    ].join("\n"),
  };
}

function createSkillSystemMessage(invocation: ActiveSkillInvocation): ChatMessage {
  return {
    role: "system",
    content: [
      `Active StoryForge skill: ${invocation.skill.name}`,
      "",
      `Invocation: ${invocation.skill.invocationName}`,
      `Arguments: ${invocation.argumentsText}`,
      "",
      "Follow this skill for the current turn. The skill instructions apply in addition to StoryForge's normal coding-agent rules. If the skill conflicts with higher-priority system instructions, follow the higher-priority instructions.",
      "If this skill describes CLI commands or command-line workflows, use StoryForge's workspace.runCommand / workspace_runCommand tool to execute those commands. Do not claim the capability is unavailable only because there is no dedicated tool named after the skill.",
      "",
      invocation.skill.body,
    ].join("\n"),
  };
}

function parseSlashInvocation(prompt: string): { command: string; argumentsText: string } | undefined {
  if (!prompt.startsWith("/")) {
    return undefined;
  }
  const [command = "", ...argumentParts] = prompt.split(/\s+/);
  if (!command || command === "/") {
    return undefined;
  }
  return {
    command,
    argumentsText: argumentParts.join(" "),
  };
}

function promptMentionsSkill(prompt: string, skill: SkillView): boolean {
  return containsToken(prompt, skill.invocationName) || containsToken(prompt, skill.name);
}

function containsToken(value: string, token: string): boolean {
  if (!token.trim()) {
    return false;
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}($|[^\\p{L}\\p{N}_-])`, "iu")
    .test(value);
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

function createPermissionRequestId(): string {
  return `sf_permission_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function createAutomationProposalId(): string {
  return `sf_automation_proposal_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function validateAutomationProposal(draft: AutomationProposalDraft) {
  const validation = validateSchedule({
    cron: draft.cron,
    timezone: draft.timezone,
  });
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  return {
    ...draft,
    cron: validation.cron,
    timezone: validation.timezone,
    summary: validation.summary,
    nextRuns: validation.nextRuns,
  };
}

function redactSecret(message: string, secret: string | undefined): string {
  return secret ? message.split(secret).join("[REDACTED]") : message;
}
