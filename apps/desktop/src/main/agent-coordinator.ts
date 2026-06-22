import {
  type AgentRuntime,
  type AgentRuntimeTurnInput,
  NativeAgentRuntime,
  RuntimeContextAssembler,
  type RuntimeContext,
  type RuntimeToolFactoryHelpers,
} from "@story-forge/agent-core";
import type {
  ModelProvider,
  ProviderId,
  ProviderConnectionConfig,
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
  type WebSearchCoverage,
} from "@story-forge/shared";
import {
  createAutomationProposalTool,
  createWebTools,
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
  type SessionRecord,
  type SessionRepository,
  type SessionStatus,
} from "./session-repository";
import type { ImageAttachmentView } from "../shared/story-forge-api";
import type { WorkspaceRepository } from "./workspace-repository";

export type ProviderFactory = {
  createProvider(config: ProviderConnectionConfig, apiKey: string): ModelProvider;
};

export type SkillInvocationResolver = {
  list?(): Promise<SkillView[]>;
  resolveInvocation(command: string): Promise<InstalledSkillRecord | undefined>;
};

export type AgentCoordinatorOptions = {
  providerStore?: ProviderConfigStore;
  sessionRepository: SessionRepository;
  workspaceRepository?: WorkspaceRepository;
  providerFactory?: ProviderFactory;
  runtime?: AgentRuntime;
  skillResolver?: SkillInvocationResolver;
  getResponseMode?: () => Promise<ResponseMode>;
  getDeveloperMode?: () => Promise<boolean>;
  getCommandExecutionMode?: () => Promise<CommandExecutionMode>;
  getWebAccessEnabled?: () => Promise<boolean>;
  getWebSearchCoverage?: () => Promise<WebSearchCoverage>;
  commandHome?: string;
  emit: (event: AgentEvent) => void;
  maxSteps?: number;
  maxDurationMs?: number;
};

type ActiveTurn = {
  sessionId: SessionId;
  controller: AbortController;
};

const PERMISSION_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export class AgentCoordinator {
  private readonly sessionRepository: SessionRepository;
  private readonly skillResolver: SkillInvocationResolver | undefined;
  private readonly getResponseMode: () => Promise<ResponseMode>;
  private readonly getDeveloperMode: () => Promise<boolean>;
  private readonly getCommandExecutionMode: () => Promise<CommandExecutionMode>;
  private readonly getWebAccessEnabled: () => Promise<boolean>;
  private readonly getWebSearchCoverage: () => Promise<WebSearchCoverage>;
  private readonly commandHome: string | undefined;
  private readonly emitEvent: (event: AgentEvent) => void;
  private readonly runtime: AgentRuntime;
  private readonly maxSteps: number | undefined;
  private readonly maxDurationMs: number | undefined;
  private readonly activeTurns = new Map<TurnId, ActiveTurn>();
  private readonly pendingPermissions = new Map<string, (approved: boolean) => void>();
  private readonly reservedSessions = new Set<SessionId>();
  private readonly turnPromises = new Map<TurnId, Promise<void>>();

  constructor(options: AgentCoordinatorOptions) {
    this.sessionRepository = options.sessionRepository;
    this.skillResolver = options.skillResolver;
    this.getResponseMode = options.getResponseMode ?? (async () => "auto");
    this.getDeveloperMode = options.getDeveloperMode ?? (async () => false);
    this.getCommandExecutionMode = options.getCommandExecutionMode ?? (async () => "sentinel");
    this.getWebAccessEnabled = options.getWebAccessEnabled ?? (async () => false);
    this.getWebSearchCoverage = options.getWebSearchCoverage ?? (async () => "focused");
    this.commandHome = options.commandHome;
    this.emitEvent = options.emit;
    this.maxSteps = options.maxSteps;
    this.maxDurationMs = options.maxDurationMs;
    this.runtime = options.runtime ?? this.createNativeRuntime(options);
  }

  async start(input: {
    sessionId: SessionId;
    prompt: string;
    imageAttachments?: ImageAttachmentView[];
  }): Promise<{ turnId: TurnId }> {
    const imageAttachments = input.imageAttachments ?? [];
    if (!input.prompt.trim() && imageAttachments.length === 0) {
      throw new Error("Prompt or image attachment must not be empty");
    }
    if (this.reservedSessions.has(input.sessionId)) {
      throw new Error(`Session already has an active turn: ${input.sessionId}`);
    }
    this.reservedSessions.add(input.sessionId);

    try {
      let session = await this.sessionRepository.get(input.sessionId);
      await this.resolveSkillInvocation(input.prompt);
      const turnId = createTurnId();
      session = await this.sessionRepository.appendMessage(input.sessionId, {
        id: createMessageId(),
        role: "user",
        content: input.prompt,
        ...(imageAttachments.length ? { imageAttachments } : {}),
        createdAt: new Date().toISOString(),
      });
      await this.sessionRepository.markStatus(input.sessionId, {
        status: "running",
        turnId,
      });

      const controller = new AbortController();
      this.activeTurns.set(turnId, { sessionId: input.sessionId, controller });
      const promise = this.executeTurn(session, turnId, input.prompt, controller.signal)
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
    prompt: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      let stopReason: AgentStopReason = "completed";
      for await (const event of this.runtime.runTurn({
        sessionId: session.id,
        turnId,
        prompt,
        signal,
      } satisfies AgentRuntimeTurnInput)) {
        if (event.type === "runtime.completed") {
          stopReason = event.stopReason ?? "completed";
        }
        if (event.type === "runtime.error") {
          stopReason = event.stopReason ?? "unrecoverable-error";
        }
        this.emitEvent(event);
      }
      await this.sessionRepository.markStatus(session.id, {
        status: statusForStopReason(stopReason),
        stopReason,
      });
    } catch (error) {
      this.emitEvent({
        type: "runtime.error",
        sessionId: session.id,
        turnId,
        message: error instanceof Error ? error.message : String(error),
        stopReason: "unrecoverable-error",
      });
      await this.sessionRepository.markStatus(session.id, {
        status: "error",
        stopReason: "unrecoverable-error",
      });
    }
  }

  private createNativeRuntime(options: AgentCoordinatorOptions): AgentRuntime {
    const providerStore = required(options.providerStore, "providerStore");
    const workspaceRepository = required(options.workspaceRepository, "workspaceRepository");
    const providerFactory = required(options.providerFactory, "providerFactory");
    const sessionStore = {
      get: (sessionId: SessionId) => this.sessionRepository.get(sessionId),
      replaceMessages: (sessionId: SessionId, messages: Parameters<SessionRepository["replaceMessages"]>[1]) =>
        this.sessionRepository.replaceMessages(sessionId, messages),
    };
    const contextAssembler = new RuntimeContextAssembler({
      sessionStore,
      workspaceStore: {
        get: (workspaceId) => workspaceRepository.get(workspaceId),
      },
      settings: {
        getResponseMode: this.getResponseMode,
        getDeveloperMode: this.getDeveloperMode,
        getCommandExecutionMode: this.getCommandExecutionMode,
        getWebAccessEnabled: this.getWebAccessEnabled,
        getWebSearchCoverage: this.getWebSearchCoverage,
      },
      ...(this.skillResolver ? { skillResolver: this.skillResolver } : {}),
    });

    return new NativeAgentRuntime({
      contextAssembler,
      providerResolver: {
        resolve: (providerId) => providerStore.resolve(providerId),
      },
      providerFactory,
      sessionStore,
      toolFactory: {
        createTools: (context, helpers) => this.createRuntimeTools(context, helpers),
      },
      ...(this.maxSteps === undefined ? {} : { maxSteps: this.maxSteps }),
      ...(this.maxDurationMs === undefined ? {} : { maxDurationMs: this.maxDurationMs }),
    });
  }

  private createRuntimeTools(
    context: RuntimeContext,
    helpers: RuntimeToolFactoryHelpers,
  ): ToolRegistry {
    const sandbox = new WorkspaceSandbox(context.workspace.path);
    return new ToolRegistry([
      ...createWorkspaceFileTools(sandbox),
      createWorkspaceCommandTool(sandbox, {
        mode: context.settings.commandExecutionMode,
        ...(this.commandHome ? { commandHome: this.commandHome } : {}),
        requestPermission: (request) =>
          this.requestCommandPermission({
            sessionId: context.session.id,
            turnId: context.turnId,
            mode: context.settings.commandExecutionMode,
            request,
            signal: helpers.signal ?? new AbortController().signal,
            emit: helpers.emit,
          }),
      }),
      ...createWebTools({
        enabled: context.settings.webAccessEnabled,
        coverage: context.settings.webSearchCoverage,
        credentials: {
          tavilyApiKey: readEnvSecret("Tavily_API_KEY", "TAVILY_API_KEY"),
          serpApiKey: readEnvSecret("SerpApi_API_KEY", "SERPAPI_API_KEY"),
        },
      }),
      createAutomationProposalTool({
        validate: (draft) => validateAutomationProposal(draft),
        emit: (proposal) => {
          const proposalSessionId = proposal.kind === "thread_chat"
            ? context.session.id
            : undefined;
          void helpers.emit({
            type: "automation.proposal",
            sessionId: context.session.id,
            turnId: context.turnId,
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
              workspaceId: context.workspace.id,
              providerId: context.session.providerId,
              model: context.session.model,
              ...(proposalSessionId ? { sessionId: proposalSessionId } : {}),
            },
          });
        },
      }),
    ]);
  }

  private async resolveSkillInvocation(
    prompt: string,
  ): Promise<{ skill: InstalledSkillRecord; argumentsText: string } | undefined> {
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
    emit: (event: AgentEvent) => void | Promise<void>;
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
      void input.emit({
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

function readEnvSecret(primary: string, fallback: string): string | undefined {
  return process.env[primary] || process.env[fallback] || undefined;
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`AgentCoordinator requires ${name} when no runtime is injected`);
  }
  return value;
}
