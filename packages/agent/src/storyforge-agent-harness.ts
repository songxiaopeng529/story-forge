import {
  defineTool,
  type AgentSession,
  type AgentSessionEvent,
  type InlineExtension,
  type ToolDefinition as PiToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  createTurnId,
  type AgentEvent,
  type AgentStopReason,
  type CommandExecutionMode,
  type ExtensionUiResponse,
  type ImageAttachmentView,
  type RuntimeEnvironmentView,
  type SessionId,
  type TaskId,
  type TurnId,
  type WebSearchCoverage,
} from "@story-forge/shared";
import {
  classifyCommand,
  checkWorkspaceToolCall,
  createAutomationProposalTool,
  createCurrentTimeTool,
  createTaskTools,
  createWebTools,
  NodeMcpToolSession,
  parseShellCommandForPolicy,
  resolvePiPlanModeExtensionPath,
  resolveSystemTimezone,
  type RuntimeClock,
  type RuntimeTimezoneResolver,
  type AutomationProposalDraft,
  type ToolDefinition as StoryForgeToolDefinition,
  validateSchedule,
} from "@story-forge/extensions";
import {
  createStoryForgeAgentSession,
  createStoryForgeSystemPrompt,
} from "./create-storyforge-session";
import {
  errorMessageFromPiMessages,
  normalizeModelRequestPayload,
  stopReasonFromPiMessages,
  toPiImageContent,
} from "./event-mapper";
import { createRuntimeEnvironmentExtension } from "./runtime-environment";
import type { PiModelService } from "./pi-model-service";
import type { PiSessionAdapter } from "./pi-session-adapter";
import {
  type SessionMetadataRecord,
  type SessionRepository,
  type SessionStatus,
} from "./session-repository";
import type {
  StoryForgeMcpSource,
  StoryForgeSkillSource,
  StoryForgeWorkspaceStore,
} from "./host";
import { PiExtensionUiBridge } from "./pi-extension-ui";

export type SkillInvocationResolver = StoryForgeSkillSource;

export type StoryForgeAgentHarnessOptions = {
  sessionRepository: SessionRepository;
  workspaceRepository: StoryForgeWorkspaceStore;
  piModels: PiModelService;
  piSessions: PiSessionAdapter;
  skillResolver?: StoryForgeSkillSource;
  mcpServerSource?: StoryForgeMcpSource;
  getDeveloperMode?: () => Promise<boolean>;
  getCommandExecutionMode?: () => Promise<CommandExecutionMode>;
  getWebAccessEnabled?: () => Promise<boolean>;
  getWebSearchCoverage?: () => Promise<WebSearchCoverage>;
  now?: RuntimeClock;
  getTimezone?: RuntimeTimezoneResolver;
  emit: (event: AgentEvent) => void;
};

type ActiveTurn = {
  sessionId: SessionId;
  storyForgeSession: SessionMetadataRecord;
  controller: AbortController;
  piSession?: AgentSession;
  unsubscribe?: () => void;
  terminalEmitted: boolean;
  stopReason: AgentStopReason;
  errorMessage: string | undefined;
  steps: number;
};

type TurnSettings = {
  developerMode: boolean;
  commandExecutionMode: CommandExecutionMode;
  webAccessEnabled: boolean;
  webSearchCoverage: WebSearchCoverage;
};

const PERMISSION_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const PI_PLAN_MODE_EXTENSION_PATH = resolvePiPlanModeExtensionPath();
export class StoryForgeAgentHarness {
  private readonly sessionRepository: SessionRepository;
  private readonly workspaceRepository: StoryForgeWorkspaceStore;
  private readonly piModels: PiModelService;
  private readonly piSessions: PiSessionAdapter;
  private readonly skillResolver: StoryForgeSkillSource | undefined;
  private readonly mcpServerSource: StoryForgeMcpSource | undefined;
  private readonly getDeveloperMode: () => Promise<boolean>;
  private readonly getCommandExecutionMode: () => Promise<CommandExecutionMode>;
  private readonly getWebAccessEnabled: () => Promise<boolean>;
  private readonly getWebSearchCoverage: () => Promise<WebSearchCoverage>;
  private readonly now: RuntimeClock;
  private readonly getTimezone: RuntimeTimezoneResolver;
  private readonly emitEvent: (event: AgentEvent) => void;
  private readonly extensionUi: PiExtensionUiBridge;
  private readonly activeTurns = new Map<TurnId, ActiveTurn>();
  private readonly pendingPermissions = new Map<string, (approved: boolean) => void>();
  private readonly reservedSessions = new Set<SessionId>();
  private readonly turnPromises = new Map<TurnId, Promise<void>>();
  private readonly piSessionCleanups = new WeakMap<AgentSession, () => void>();

  constructor(options: StoryForgeAgentHarnessOptions) {
    this.sessionRepository = options.sessionRepository;
    this.workspaceRepository = options.workspaceRepository;
    this.piModels = options.piModels;
    this.piSessions = options.piSessions;
    this.skillResolver = options.skillResolver;
    this.mcpServerSource = options.mcpServerSource;
    this.getDeveloperMode = options.getDeveloperMode ?? (async () => false);
    this.getCommandExecutionMode = options.getCommandExecutionMode ?? (async () => "sentinel");
    this.getWebAccessEnabled = options.getWebAccessEnabled ?? (async () => false);
    this.getWebSearchCoverage = options.getWebSearchCoverage ?? (async () => "focused");
    this.now = options.now ?? (() => new Date());
    this.getTimezone = options.getTimezone ?? resolveSystemTimezone;
    this.emitEvent = options.emit;
    this.extensionUi = new PiExtensionUiBridge(this.emitEvent);
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
      const turnId = createTurnId();
      if (session.title === "New session" && input.prompt.trim()) {
        session = await this.sessionRepository.rename(input.sessionId, deriveTitle(input.prompt));
      }
      await this.sessionRepository.markStatus(input.sessionId, {
        status: "running",
        turnId,
      });

      const active: ActiveTurn = {
        sessionId: input.sessionId,
        storyForgeSession: session,
        controller: new AbortController(),
        terminalEmitted: false,
        stopReason: "completed",
        errorMessage: undefined,
        steps: 0,
      };
      this.activeTurns.set(turnId, active);
      const promise = this.executeTurn({
        active,
        turnId,
        prompt: input.prompt,
        imageAttachments,
      }).finally(() => {
        this.extensionUi.cancelTurn(turnId);
        active.unsubscribe?.();
        this.disposePiSession(active.piSession);
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
    providerId: string;
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
    const active = this.activeTurns.get(turnId);
    active?.controller.abort();
    this.extensionUi.cancelTurn(turnId);
    await active?.piSession?.abort();
  }

  async compactSession(sessionId: SessionId): Promise<void> {
    if (this.reservedSessions.has(sessionId)) {
      throw new Error(`Session already has an active turn: ${sessionId}`);
    }
    this.reservedSessions.add(sessionId);
    const turnId = createTurnId();
    const controller = new AbortController();
    let piSession: AgentSession | undefined;
    try {
      const session = await this.sessionRepository.get(sessionId);
      piSession = await this.createPiSessionForTurn({
        session,
        turnId,
        settings: await this.readTurnSettings(),
        signal: controller.signal,
      });
      await piSession.compact();
      this.emitEvent({
        type: "context.compacted",
        sessionId,
        turnId,
        trigger: "manual",
      });
    } finally {
      this.disposePiSession(piSession);
      this.reservedSessions.delete(sessionId);
    }
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

  respondToExtensionUi(input: ExtensionUiResponse): void {
    this.extensionUi.respond(input);
  }

  private async executeTurn(input: {
    active: ActiveTurn;
    turnId: TurnId;
    prompt: string;
    imageAttachments: ImageAttachmentView[];
  }): Promise<void> {
    const { active, turnId } = input;
    try {
      const settings = await this.readTurnSettings();
      const piSession = await this.createPiSessionForTurn({
        session: active.storyForgeSession,
        turnId,
        settings,
        signal: active.controller.signal,
      });
      active.piSession = piSession;
      active.unsubscribe = piSession.subscribe((event) => {
        this.mapPiEvent({
          active,
          turnId,
          event,
        });
      });
      if (active.controller.signal.aborted) {
        await piSession.abort();
        return;
      }
      const onAbort = () => {
        void piSession.abort();
      };
      active.controller.signal.addEventListener("abort", onAbort, { once: true });
      try {
        await piSession.prompt(input.prompt, {
          images: input.imageAttachments.map(toPiImageContent),
          source: "interactive",
        });
        await piSession.waitForIdle();
      } finally {
        active.controller.signal.removeEventListener("abort", onAbort);
      }
      this.emitTerminalForStopReason(active, turnId);
      await this.sessionRepository.markStatus(active.sessionId, {
        status: statusForStopReason(active.stopReason),
        stopReason: active.stopReason,
      });
    } catch (error) {
      const stopReason: AgentStopReason = active.controller.signal.aborted
        ? "user-stopped"
        : "unrecoverable-error";
      active.stopReason = stopReason;
      this.emitTerminalIfNeeded(active, turnId, "runtime.error", formatError(error), stopReason);
      await this.sessionRepository.markStatus(active.sessionId, {
        status: stopReason === "user-stopped" ? "stopped" : "error",
        stopReason,
      });
    }
  }

  private async createPiSessionForTurn(input: {
    session: SessionMetadataRecord;
    turnId: TurnId;
    settings: TurnSettings;
    signal: AbortSignal;
  }): Promise<AgentSession> {
    const refs = await this.piSessions.ensurePiSession(input.session);
    let session = input.session;
    if (refs.piSessionFile !== input.session.piSessionFile || refs.piSessionId !== input.session.piSessionId) {
      session = await this.sessionRepository.attachPiSession(input.session.id, refs);
    }
    const workspace = await this.workspaceRepository.get(session.workspaceId);
    const settingsManager = this.piModels.createSettingsManager(workspace.path);
    const modelRuntime = await this.piModels.getModelRuntime();
    const model = await this.piModels.resolveModel(session.providerId, session.model);
    const [additionalSkillPaths, mcpServers] = await Promise.all([
      this.skillResolver?.listEnabledSkillPaths() ?? Promise.resolve([]),
      this.mcpServerSource?.listEnabledMcpServers() ?? Promise.resolve([]),
    ]);
    const mcpToolSession = new NodeMcpToolSession();
    const mcpRuntime = await mcpToolSession.loadTools(mcpServers);
    for (const diagnostic of mcpRuntime.diagnostics) {
      console.warn(`MCP server ${diagnostic.serverName}: ${diagnostic.error}`);
    }
    const extensionTools = [
      ...this.createStoryForgeTools({
        session,
        turnId: input.turnId,
        workspacePath: workspace.path,
        settings: input.settings,
      }),
      ...mcpRuntime.tools.map(toPiToolDefinition),
    ];
    const runtimeEnvironment = createRuntimeEnvironmentExtension({
      now: this.now,
      getTimezone: this.getTimezone,
    });

    try {
      const piSession = await createStoryForgeAgentSession({
        cwd: workspace.path,
        agentDir: this.piModels.getAgentDir(),
        modelRuntime,
        ...(model ? { model } : {}),
        settingsManager,
        sessionManager: await this.piSessions.openSessionManager(session),
        additionalExtensionPaths: [PI_PLAN_MODE_EXTENSION_PATH],
        extensionUiContext: this.extensionUi.createContext({
          sessionId: session.id,
          turnId: input.turnId,
          signal: input.signal,
        }),
        additionalSkillPaths,
        extensionToolNames: extensionTools.map((tool) => tool.name),
        extensionFactories: [
          runtimeEnvironment.extension,
          this.createStoryForgeExtension({
            session,
            turnId: input.turnId,
            workspacePath: workspace.path,
            settings: input.settings,
            signal: input.signal,
          }, extensionTools, runtimeEnvironment.getLatest),
        ],
        systemPrompt: createStoryForgeSystemPrompt({
          extensionTools,
        }),
        onExtensionError: (error) => {
          this.emitEvent({
            type: "runtime.error",
            sessionId: session.id,
            turnId: input.turnId,
            message: error.error,
            stopReason: "unrecoverable-error",
          });
        },
      });
      this.piSessionCleanups.set(piSession, () => mcpToolSession.close());
      return piSession;
    } catch (error) {
      mcpToolSession.close();
      throw error;
    }
  }

  private createStoryForgeExtension(input: {
    session: SessionMetadataRecord;
    turnId: TurnId;
    workspacePath: string;
    settings: TurnSettings;
    signal: AbortSignal;
  }, tools: PiToolDefinition[], getRuntimeEnvironment: () => RuntimeEnvironmentView | undefined): InlineExtension {
    return {
      name: "storyforge-harness",
      hidden: true,
      factory: (pi) => {
        pi.on("tool_call", async (event) => {
          const workspaceBlock = checkWorkspaceToolCall(input.workspacePath, event.toolName, event.input);
          if (workspaceBlock) {
            return workspaceBlock;
          }
          if (event.toolName === "bash") {
            return this.guardBashToolCall(input, event.input);
          }
          if (event.toolName === "write" || event.toolName === "edit") {
            return this.guardMutationToolCall(input, event.toolName, event.input);
          }
          return undefined;
        });
        pi.on("before_provider_request", (event) => {
          if (!input.settings.developerMode) {
            return undefined;
          }
          const environment = getRuntimeEnvironment();
          this.emitEvent({
            type: "model.request",
            sessionId: input.session.id,
            turnId: input.turnId,
            requestId: createModelRequestId(),
            providerId: input.session.providerId,
            model: input.session.model,
            ...(environment ? { environment } : {}),
            ...normalizeModelRequestPayload(event.payload),
          });
          return undefined;
        });
        for (const tool of tools) {
          pi.registerTool(tool);
        }
      },
    };
  }

  private createStoryForgeTools(input: {
    session: SessionMetadataRecord;
    turnId: TurnId;
    workspacePath: string;
    settings: TurnSettings;
  }): PiToolDefinition[] {
    const environmentTools = [
      createCurrentTimeTool({
        now: this.now,
        getTimezone: this.getTimezone,
      }),
    ];
    const taskTools = createTaskTools({
      turnId: input.turnId,
      store: {
        listTasks: () => this.sessionRepository.listTasks(input.session.id),
        createTask: async (taskInput) => {
          const session = await this.sessionRepository.createTask(input.session.id, taskInput);
          const task = session.tasks.at(-1);
          if (!task) {
            throw new Error("Task was not created");
          }
          this.emitEvent({
            type: "task.list.updated",
            sessionId: input.session.id,
            turnId: input.turnId,
            tasks: session.tasks,
            changedTaskId: task.id,
            reason: "created",
          });
          return { task, tasks: session.tasks };
        },
        updateTask: async (taskInput) => {
          const session = await this.sessionRepository.updateTask(input.session.id, taskInput);
          const task = session.tasks.find((candidate) => candidate.id === taskInput.taskId);
          if (!task) {
            throw new Error(`Task not found: ${taskInput.taskId}`);
          }
          this.emitEvent({
            type: "task.list.updated",
            sessionId: input.session.id,
            turnId: input.turnId,
            tasks: session.tasks,
            changedTaskId: task.id as TaskId,
            reason: "updated",
          });
          return { task, tasks: session.tasks };
        },
      },
    });
    const webTools = createWebTools({
      enabled: input.settings.webAccessEnabled,
      coverage: input.settings.webSearchCoverage,
      credentials: {
        tavilyApiKey: readEnvSecret("Tavily_API_KEY", "TAVILY_API_KEY"),
        serpApiKey: readEnvSecret("SerpApi_API_KEY", "SERPAPI_API_KEY"),
      },
      now: this.now,
    });
    const automationTools = [
      createAutomationProposalTool({
        validate: (draft) => validateAutomationProposal(draft),
        emit: (proposal) => {
          this.emitEvent({
            type: "automation.proposal",
            sessionId: input.session.id,
            turnId: input.turnId,
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
              workspaceId: input.session.workspaceId,
              providerId: input.session.providerId,
              model: input.session.model,
              ...(proposal.kind === "thread_chat" ? { sessionId: input.session.id } : {}),
            },
          });
        },
      }),
    ];
    return [...environmentTools, ...taskTools, ...webTools, ...automationTools]
      .map(toPiToolDefinition);
  }

  private async guardBashToolCall(
    input: {
      session: SessionMetadataRecord;
      turnId: TurnId;
      workspacePath: string;
      settings: TurnSettings;
      signal: AbortSignal;
    },
    rawInput: unknown,
  ) {
    const command = readStringField(rawInput, "command");
    const parsed = parseShellCommandForPolicy(command);
    const decision = classifyCommand({
      mode: input.settings.commandExecutionMode,
      program: parsed.program,
      args: parsed.args,
    });
    if (decision.action === "deny") {
      return { block: true, reason: decision.reason };
    }
    if (decision.action === "confirm") {
      const approved = await this.requestCommandPermission({
        sessionId: input.session.id,
        turnId: input.turnId,
        mode: input.settings.commandExecutionMode,
        request: {
          reason: decision.reason,
          risk: decision.risk,
          command: {
            program: parsed.program,
            args: parsed.args,
            cwd: input.workspacePath,
          },
        },
        signal: input.signal,
      });
      if (!approved) {
        return { block: true, reason: `Command denied: ${decision.reason}` };
      }
    }
    return undefined;
  }

  private async guardMutationToolCall(
    input: {
      session: SessionMetadataRecord;
      turnId: TurnId;
      workspacePath: string;
      settings: TurnSettings;
      signal: AbortSignal;
    },
    toolName: string,
    rawInput: unknown,
  ) {
    if (input.settings.commandExecutionMode === "unleashed") {
      return undefined;
    }
    const targetPath = readStringField(rawInput, "path");
    const approved = await this.requestCommandPermission({
      sessionId: input.session.id,
      turnId: input.turnId,
      mode: input.settings.commandExecutionMode,
      request: {
        reason: `${toolName} will modify ${targetPath}.`,
        risk: "destructive",
        command: {
          program: toolName,
          args: [targetPath],
          cwd: input.workspacePath,
        },
      },
      signal: input.signal,
    });
    if (!approved) {
      return { block: true, reason: `${toolName} denied by user.` };
    }
    return undefined;
  }

  private requestCommandPermission(input: {
    sessionId: SessionId;
    turnId: TurnId;
    mode: CommandExecutionMode;
    request: {
      reason: string;
      risk: "unknown" | "high" | "destructive" | "elevated";
      command: {
        program: string;
        args: string[];
        cwd: string;
      };
    };
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

  private mapPiEvent(input: {
    active: ActiveTurn;
    turnId: TurnId;
    event: AgentSessionEvent;
  }): void {
    const { active, turnId, event } = input;
    if (event.type === "agent_start") {
      this.emitEvent({
        type: "runtime.started",
        sessionId: active.sessionId,
        turnId,
        createdAt: new Date().toISOString(),
      });
      return;
    }
    if (event.type === "message_update") {
      const assistantEvent = event.assistantMessageEvent as { type: string; delta?: string };
      if (assistantEvent.type === "text_delta" && assistantEvent.delta) {
        this.emitEvent({
          type: "message.delta",
          sessionId: active.sessionId,
          turnId,
          content: assistantEvent.delta,
          delivery: "live",
        });
      }
      return;
    }
    if (event.type === "tool_execution_start") {
      active.steps += 1;
      this.emitEvent({
        type: "tool.call",
        sessionId: active.sessionId,
        turnId,
        callId: event.toolCallId,
        name: event.toolName,
        input: event.args,
      });
      return;
    }
    if (event.type === "tool_execution_end") {
      const completedPlan = event.toolName === "plan_mode_complete"
        ? readCompletedPlan(event.result)
        : undefined;
      if (completedPlan && !event.isError) {
        this.emitEvent({
          type: "plan.ready",
          sessionId: active.sessionId,
          turnId,
          plan: completedPlan,
        });
      }
      this.emitEvent({
        type: "tool.result",
        sessionId: active.sessionId,
        turnId,
        callId: event.toolCallId,
        name: event.toolName,
        ok: !event.isError,
        output: event.result,
      });
      return;
    }
    if (event.type === "agent_end") {
      active.stopReason = stopReasonFromPiMessages(event.messages, active.controller.signal.aborted);
      active.errorMessage = errorMessageFromPiMessages(event.messages);
      return;
    }
    if (event.type === "compaction_end") {
      if (event.result) {
        this.emitEvent({
          type: "context.compacted",
          sessionId: active.sessionId,
          turnId,
          trigger: event.reason === "manual" ? "manual" : "auto",
        });
      }
      return;
    }
    // PI extensions may continue the workflow after the model settles, for
    // example by asking whether a completed plan should be implemented. The
    // enclosing prompt/waitForIdle lifecycle owns the terminal event.
  }

  private emitTerminalForStopReason(active: ActiveTurn, turnId: TurnId): void {
    if (active.stopReason === "unrecoverable-error") {
      this.emitTerminalIfNeeded(
        active,
        turnId,
        "runtime.error",
        active.errorMessage ?? "PI model request failed",
      );
      return;
    }
    this.emitTerminalIfNeeded(active, turnId, "runtime.completed");
  }

  private emitTerminalIfNeeded(
    active: ActiveTurn,
    turnId: TurnId,
    type: "runtime.completed" | "runtime.error",
    message?: string,
    stopReason = active.stopReason,
  ): void {
    if (active.terminalEmitted) {
      return;
    }
    active.terminalEmitted = true;
    if (type === "runtime.error") {
      this.emitEvent({
        type: "runtime.error",
        sessionId: active.sessionId,
        turnId,
        message: message ?? "PI Agent runtime error",
        stopReason,
        steps: active.steps,
      });
      return;
    }
    this.emitEvent({
      type: "runtime.completed",
      sessionId: active.sessionId,
      turnId,
      stopReason,
      steps: active.steps,
    });
  }

  private async readTurnSettings(): Promise<TurnSettings> {
    const [
      developerMode,
      commandExecutionMode,
      webAccessEnabled,
      webSearchCoverage,
    ] = await Promise.all([
      this.getDeveloperMode(),
      this.getCommandExecutionMode(),
      this.getWebAccessEnabled(),
      this.getWebSearchCoverage(),
    ]);
    return {
      developerMode,
      commandExecutionMode,
      webAccessEnabled,
      webSearchCoverage,
    };
  }

  private disposePiSession(session: AgentSession | undefined): void {
    if (!session) {
      return;
    }
    try {
      session.dispose();
    } finally {
      this.piSessionCleanups.get(session)?.();
      this.piSessionCleanups.delete(session);
    }
  }
}

function toPiToolDefinition(tool: StoryForgeToolDefinition): PiToolDefinition {
  return defineTool({
    name: tool.name,
    label: tool.name,
    description: tool.description,
    promptSnippet: tool.description,
    parameters: tool.parameters as never,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      const output = await tool.execute(
        params as Record<string, unknown>,
        signal ? { signal } : {},
      );
      return {
        content: [{ type: "text", text: formatToolOutput(output) }],
        details: output,
      };
    },
  });
}

function readCompletedPlan(result: unknown): string | undefined {
  const details = toRecord(result).details;
  const plan = toRecord(details).plan;
  return typeof plan === "string" && plan.trim() ? plan.trim() : undefined;
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

function readStringField(input: unknown, field: string): string {
  const value = toRecord(input)[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Expected non-empty string field: ${field}`);
  }
  return value.trim();
}

function readOptionalStringField(input: unknown, field: string): string | undefined {
  const value = toRecord(input)[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function formatToolOutput(output: unknown): string {
  return typeof output === "string" ? output : JSON.stringify(output, null, 2);
}

function deriveTitle(content: string): string {
  const firstLine = content.trim().split(/\r?\n/, 1)[0] ?? "";
  return firstLine.slice(0, 50) || "New session";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createPermissionRequestId(): string {
  return `sf_permission_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function createAutomationProposalId(): string {
  return `sf_automation_proposal_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function createModelRequestId(): string {
  return `sf_model_request_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function readEnvSecret(primary: string, fallback: string): string | undefined {
  return process.env[primary] || process.env[fallback] || undefined;
}
