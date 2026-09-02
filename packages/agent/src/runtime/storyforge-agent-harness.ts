import {
  type AgentSession,
  type AgentSessionEvent,
  type ContextUsage,
  type ExtensionUIContext,
  type InlineExtension,
  type ToolDefinition as PiToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  createId,
  createTurnId,
  formatError,
  readOptionalStringField,
  readStringField,
  toRecord,
  type AgentStopReason,
  type AgentDelegateInput,
  type DelegateResult,
  type CommandExecutionMode,
  type ContextUsageEvent,
  type ExtensionUiResponse,
  type HumanInputRequestPayload,
  type HumanInputResponse,
  type ImageAttachmentView,
  type RuntimeEnvironmentView,
  type SessionId,
  type SoulDocumentView,
  type SoulMode,
  type TurnId,
  type UnsequencedAgentEvent,
  type WebSearchCoverage,
} from "@story-forge/shared";
import {
  classifyCommand,
  checkWorkspaceToolCall,
  createAutomationProposalTool,
  createAgentDelegateTool,
  createCurrentTimeTool,
  createHumanInputTool,
  createSoulUpdateTool,
  createWebTools,
  NodeMcpToolSession,
  parseShellCommandForPolicy,
  PI_TODO_TOOL_NAME,
  resolvePiTodoExtensionPath,
  resolveSystemTimezone,
  type RuntimeClock,
  type RuntimeTimezoneResolver,
  type AutomationProposalDraft,
  type HumanInputToolResponse,
  validateSchedule,
} from "@story-forge/extensions";
import {
  createStoryForgeAgentSession,
  createStoryForgeSystemPrompt,
} from "../pi/create-storyforge-session";
import {
  errorMessageFromPiMessages,
  normalizeModelRequestPayload,
  stopReasonFromPiMessages,
  toPiImageContent,
} from "../pi/event-mapper";
import { createRuntimeEnvironmentExtension } from "./runtime-environment";
import { formatStoryForgeSoulContext } from "./soul-context";
import type { PiModelService } from "../pi/pi-model-service";
import type { PiSessionAdapter } from "../pi/pi-session-adapter";
import {
  type SessionMetadataRecord,
  type SessionRepository,
} from "../persistence/session-repository";
import type {
  StoryForgeMcpSource,
  StoryForgeSkillSource,
  StoryForgeSoulStore,
  StoryForgeWorkspaceStore,
} from "../ports/host";
import { PiExtensionUiBridge } from "../pi/pi-extension-ui";
import { toSessionTasksFromPiTodoResult } from "../pi/pi-todo-adapter";
import { toPiToolDefinition } from "../pi/storyforge-tool-adapter";
import type { TurnOutcome } from "./turn-outcome";

export type SkillInvocationResolver = StoryForgeSkillSource;

export type StoryForgeAgentHarnessOptions = {
  sessionRepository: SessionRepository;
  workspaceRepository: StoryForgeWorkspaceStore;
  piModels: PiModelService;
  piSessions: PiSessionAdapter;
  skillResolver?: StoryForgeSkillSource;
  mcpServerSource?: StoryForgeMcpSource;
  soulStore?: StoryForgeSoulStore;
  getDeveloperMode?: () => Promise<boolean>;
  getCommandExecutionMode?: () => Promise<CommandExecutionMode>;
  getWebAccessEnabled?: () => Promise<boolean>;
  getWebSearchCoverage?: () => Promise<WebSearchCoverage>;
  getSoulMode?: () => Promise<SoulMode>;
  delegate?: (input: RootDelegateRequest) => Promise<DelegateResult>;
  onTurnModelResolved?: (input: TurnModelResolved) => void;
  createAgentSession?: typeof createStoryForgeAgentSession;
  now?: RuntimeClock;
  getTimezone?: RuntimeTimezoneResolver;
  emit: (event: UnsequencedAgentEvent) => void;
};

export type RootDelegateRequest = {
  sessionId: SessionId;
  turnId: TurnId;
  workspaceId: string;
  providerId: string;
  model: string;
  input: AgentDelegateInput;
  signal: AbortSignal;
};

export type TurnModelResolved = {
  sessionId: SessionId;
  turnId: TurnId;
  workspaceId: string;
  providerId: string;
  model: string;
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
  metadataSync: Promise<void>;
  modelSelection?: TurnModelSelection;
};

type TurnModelSelection = {
  providerId: string;
  model: string;
};

type TurnSettings = {
  developerMode: boolean;
  commandExecutionMode: CommandExecutionMode;
  webAccessEnabled: boolean;
  webSearchCoverage: WebSearchCoverage;
  soulMode: SoulMode;
};

type PendingHumanInputRequest = {
  turnId: TurnId;
  resolve(response: HumanInputToolResponse): void;
  cancel(): void;
};

const PERMISSION_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const PI_TODO_EXTENSION_PATH = resolvePiTodoExtensionPath();
export class StoryForgeAgentHarness {
  private readonly sessionRepository: SessionRepository;
  private readonly workspaceRepository: StoryForgeWorkspaceStore;
  private readonly piModels: PiModelService;
  private readonly piSessions: PiSessionAdapter;
  private readonly skillResolver: StoryForgeSkillSource | undefined;
  private readonly mcpServerSource: StoryForgeMcpSource | undefined;
  private readonly soulStore: StoryForgeSoulStore | undefined;
  private readonly getDeveloperMode: () => Promise<boolean>;
  private readonly getCommandExecutionMode: () => Promise<CommandExecutionMode>;
  private readonly getWebAccessEnabled: () => Promise<boolean>;
  private readonly getWebSearchCoverage: () => Promise<WebSearchCoverage>;
  private readonly getSoulMode: () => Promise<SoulMode>;
  private readonly delegate: ((input: RootDelegateRequest) => Promise<DelegateResult>) | undefined;
  private readonly onTurnModelResolved: ((input: TurnModelResolved) => void) | undefined;
  private readonly createAgentSession: typeof createStoryForgeAgentSession;
  private readonly now: RuntimeClock;
  private readonly getTimezone: RuntimeTimezoneResolver;
  private readonly emitEvent: (event: UnsequencedAgentEvent) => void;
  private readonly extensionUi: PiExtensionUiBridge;
  private readonly activeTurns = new Map<TurnId, ActiveTurn>();
  private readonly pendingPermissions = new Map<string, (approved: boolean) => void>();
  private readonly pendingHumanInputs = new Map<string, PendingHumanInputRequest>();
  private readonly reservedSessions = new Set<SessionId>();
  private readonly turnPromises = new Map<TurnId, Promise<TurnOutcome>>();
  private readonly piSessionCleanups = new WeakMap<AgentSession, () => void>();

  constructor(options: StoryForgeAgentHarnessOptions) {
    this.sessionRepository = options.sessionRepository;
    this.workspaceRepository = options.workspaceRepository;
    this.piModels = options.piModels;
    this.piSessions = options.piSessions;
    this.skillResolver = options.skillResolver;
    this.mcpServerSource = options.mcpServerSource;
    this.soulStore = options.soulStore;
    this.getDeveloperMode = options.getDeveloperMode ?? (async () => false);
    this.getCommandExecutionMode = options.getCommandExecutionMode ?? (async () => "sentinel");
    this.getWebAccessEnabled = options.getWebAccessEnabled ?? (async () => false);
    this.getWebSearchCoverage = options.getWebSearchCoverage ?? (async () => "focused");
    this.getSoulMode = options.getSoulMode ?? (async () => "ask");
    this.delegate = options.delegate;
    this.onTurnModelResolved = options.onTurnModelResolved;
    this.createAgentSession = options.createAgentSession ?? createStoryForgeAgentSession;
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
    return this.startTurn(input);
  }

  private async startTurn(input: {
    sessionId: SessionId;
    prompt: string;
    imageAttachments?: ImageAttachmentView[];
  }, modelSelection?: TurnModelSelection): Promise<{ turnId: TurnId }> {
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
        metadataSync: Promise.resolve(),
        ...(modelSelection ? { modelSelection } : {}),
      };
      this.activeTurns.set(turnId, active);
      const promise = this.executeTurn({
        active,
        turnId,
        prompt: input.prompt,
        imageAttachments,
      }).finally(() => {
        this.cancelHumanInputTurn(turnId);
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
    const { turnId } = await this.startTurn(
      {
        sessionId: session.id,
        prompt: input.prompt,
      },
      {
        providerId: input.providerId,
        model: input.model,
      },
    );
    return { sessionId: session.id, turnId };
  }

  async stop(turnId: TurnId): Promise<void> {
    const active = this.activeTurns.get(turnId);
    active?.controller.abort();
    this.cancelHumanInputTurn(turnId);
    this.extensionUi.cancelTurn(turnId);
    await active?.piSession?.abort();
  }

  async compactSession(sessionId: SessionId): Promise<{ turnId: TurnId }> {
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
      await this.sessionRepository.markStatus(sessionId, {
        status: session.status,
        turnId,
      });
      this.emitEvent({
        type: "context.compacted",
        sessionId,
        turnId,
        trigger: "manual",
      });
      return { turnId };
    } finally {
      this.disposePiSession(piSession);
      this.reservedSessions.delete(sessionId);
    }
  }

  async waitForTurn(turnId: TurnId): Promise<TurnOutcome> {
    const promise = this.turnPromises.get(turnId);
    if (!promise) {
      throw new Error(`Turn is not active or retained: ${turnId}`);
    }
    try {
      return await promise;
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

  respondToHumanInput(input: HumanInputResponse): void {
    const pending = this.pendingHumanInputs.get(input.requestId);
    if (!pending) {
      return;
    }
    pending.resolve(toHumanInputToolResponse(input));
  }

  private async executeTurn(input: {
    active: ActiveTurn;
    turnId: TurnId;
    prompt: string;
    imageAttachments: ImageAttachmentView[];
  }): Promise<TurnOutcome> {
    const { active, turnId } = input;
    let executionError: unknown;
    try {
      const settings = await this.readTurnSettings();
      const piSession = await this.createPiSessionForTurn({
        session: active.storyForgeSession,
        turnId,
        settings,
        signal: active.controller.signal,
        ...(active.modelSelection ? { modelSelection: active.modelSelection } : {}),
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
      } else {
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
      }
    } catch (error) {
      executionError = error;
      active.stopReason = active.controller.signal.aborted
        ? "user-stopped"
        : "unrecoverable-error";
      active.errorMessage = formatError(error);
    }

    if (active.controller.signal.aborted) {
      active.stopReason = "user-stopped";
    }
    await active.metadataSync;
    const outcome = toTurnOutcome(active, executionError);
    await this.sessionRepository.markStatus(active.sessionId, {
      status: outcome.status === "completed"
        ? "completed"
        : outcome.status === "stopped"
          ? "stopped"
          : "error",
      stopReason: outcome.stopReason,
    });
    this.emitTerminalForStopReason(active, turnId);
    return outcome;
  }

  private async createPiSessionForTurn(input: {
    session: SessionMetadataRecord;
    turnId: TurnId;
    settings: TurnSettings;
    signal: AbortSignal;
    modelSelection?: TurnModelSelection;
  }): Promise<AgentSession> {
    let session = input.session;
    // Interactive turns follow the latest global selection. Standalone
    // automation runs pass an explicit selection so their configured model wins.
    const model = input.modelSelection
      ? await this.piModels.resolveModel(
        input.modelSelection.providerId,
        input.modelSelection.model,
      )
      : await this.piModels.resolveModel(undefined, undefined)
        ?? await this.piModels.resolveModel(session.providerId, session.model);
    if (model && (model.provider !== session.providerId || model.id !== session.model)) {
      session = await this.sessionRepository.updateModel(session.id, {
        providerId: model.provider,
        model: model.id,
      });
    }
    this.onTurnModelResolved?.({
      sessionId: session.id,
      turnId: input.turnId,
      workspaceId: session.workspaceId,
      providerId: model?.provider ?? session.providerId,
      model: model?.id ?? session.model,
    });
    const refs = await this.piSessions.ensurePiSession(session);
    if (refs.piSessionFile !== input.session.piSessionFile || refs.piSessionId !== input.session.piSessionId) {
      session = await this.sessionRepository.attachPiSession(input.session.id, refs);
      if (model) {
        // A concurrent default-model change may update persisted metadata while
        // the transcript is opening. This in-flight turn keeps its chosen model.
        session = {
          ...session,
          providerId: model.provider,
          model: model.id,
        };
      }
    }
    const workspace = await this.workspaceRepository.get(session.workspaceId);
    const settingsManager = this.piModels.createSettingsManager(workspace.path);
    const modelRuntime = await this.piModels.getModelRuntime();
    const [additionalSkillPaths, mcpServers, soulDocument] = await Promise.all([
      this.skillResolver?.listEnabledSkillPaths() ?? Promise.resolve([]),
      this.mcpServerSource?.listEnabledMcpServers() ?? Promise.resolve([]),
      this.readSoulDocument(input.settings.soulMode),
    ]);
    const mcpToolSession = new NodeMcpToolSession();
    const mcpRuntime = await mcpToolSession.loadTools(mcpServers);
    for (const diagnostic of mcpRuntime.diagnostics) {
      console.warn(`MCP server ${diagnostic.serverName}: ${diagnostic.error}`);
    }
    const extensionUiContext = this.extensionUi.createContext({
      sessionId: session.id,
      turnId: input.turnId,
      signal: input.signal,
    });
    const extensionTools = [
      ...this.createStoryForgeTools({
        session,
        turnId: input.turnId,
        workspacePath: workspace.path,
        settings: input.settings,
        signal: input.signal,
        extensionUiContext,
        soulDocument,
      }),
      ...mcpRuntime.tools.map(toPiToolDefinition),
    ];
    const runtimeEnvironment = createRuntimeEnvironmentExtension({
      now: this.now,
      getTimezone: this.getTimezone,
    });
    const soulContext = input.settings.soulMode === "off"
      ? undefined
      : formatStoryForgeSoulContext(soulDocument);

    try {
      const piSession = await this.createAgentSession({
        cwd: workspace.path,
        agentDir: this.piModels.getAgentDir(),
        modelRuntime,
        ...(model ? { model } : {}),
        settingsManager,
        sessionManager: await this.piSessions.openSessionManager(session),
        additionalExtensionPaths: [PI_TODO_EXTENSION_PATH],
        extensionUiContext,
        additionalSkillPaths,
        extensionToolNames: [
          ...extensionTools.map((tool) => tool.name),
          PI_TODO_TOOL_NAME,
        ],
        extensionFactories: [
          runtimeEnvironment.extension,
          this.createStoryForgeExtension({
            session,
            turnId: input.turnId,
            workspacePath: workspace.path,
            settings: input.settings,
            signal: input.signal,
            soulDocument,
          }, extensionTools, runtimeEnvironment.getLatest),
        ],
        systemPrompt: createStoryForgeSystemPrompt({
          extensionTools,
          soulUpdatesEnabled: input.settings.soulMode === "ask" && Boolean(this.soulStore),
        }),
        ...(soulContext ? { appendSystemPrompt: soulContext } : {}),
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
    soulDocument: SoulDocumentView | undefined;
  }, tools: PiToolDefinition[], getRuntimeEnvironment: () => RuntimeEnvironmentView | undefined): InlineExtension {
    return {
      name: "storyforge-harness",
      hidden: true,
      factory: (pi) => {
        pi.on("tool_call", async (event) => {
          const workspaceBlock = await checkWorkspaceToolCall(
            input.workspacePath,
            event.toolName,
            event.input,
          );
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
            requestId: createId("model_request"),
            providerId: input.session.providerId,
            model: input.session.model,
            ...(environment ? { environment } : {}),
            ...(input.settings.soulMode !== "off" && input.soulDocument
              ? {
                  soul: {
                    status: input.soulDocument.content.trim() ? "active" : "empty",
                    filePath: input.soulDocument.filePath,
                    byteLength: input.soulDocument.byteLength,
                  } as const,
                }
              : {}),
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
    signal: AbortSignal;
    extensionUiContext: ExtensionUIContext;
    soulDocument: SoulDocumentView | undefined;
  }): PiToolDefinition[] {
    const environmentTools = [
      createCurrentTimeTool({
        now: this.now,
        getTimezone: this.getTimezone,
      }),
    ];
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
            proposalId: createId("automation_proposal"),
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
    const humanInputTools = [
      createHumanInputTool({
        request: (request, context) => this.requestHumanInput({
          sessionId: input.session.id,
          turnId: input.turnId,
          request,
          signal: context.signal ?? input.signal,
        }),
      }),
    ];
    let currentSoulDocument = input.soulDocument;
    const soulTools = input.settings.soulMode === "ask"
      && currentSoulDocument
      && this.soulStore
      ? [
          createSoulUpdateTool({
            propose: async (proposal) => {
              const approved = await input.extensionUiContext.confirm(
                "Update Soul memory?",
                formatSoulUpdateConfirmation(proposal.reason, proposal.content),
              );
              if (!approved) {
                return {
                  approved: false,
                  message: "The user declined the soul.md update.",
                };
              }
              const saved = await this.soulStore!.save({
                content: proposal.content,
                expectedRevision: currentSoulDocument!.revision,
              });
              currentSoulDocument = saved;
              return {
                approved: true,
                document: saved,
                message: "soul.md was updated. The new context applies from the next turn.",
              };
            },
          }),
        ]
      : [];
    const delegateTools = this.delegate
      ? [
          createAgentDelegateTool({
            delegate: (delegateInput, context) => this.delegate!({
              sessionId: input.session.id,
              turnId: input.turnId,
              workspaceId: input.session.workspaceId,
              providerId: input.session.providerId,
              model: input.session.model,
              input: delegateInput,
              signal: context.signal ?? input.signal,
            }),
          }),
        ]
      : [];
    return [
      ...environmentTools,
      ...webTools,
      ...automationTools,
      ...humanInputTools,
      ...soulTools,
      ...delegateTools,
    ]
      .map(toPiToolDefinition);
  }

  private async readSoulDocument(mode: SoulMode): Promise<SoulDocumentView | undefined> {
    if (mode === "off" || !this.soulStore) {
      return undefined;
    }
    try {
      return await this.soulStore.get();
    } catch (error) {
      console.warn(`Unable to load soul.md: ${formatError(error)}`);
      return undefined;
    }
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
    const requestId = createId("permission");

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

  private requestHumanInput(input: {
    sessionId: SessionId;
    turnId: TurnId;
    request: HumanInputRequestPayload;
    signal?: AbortSignal;
  }): Promise<HumanInputToolResponse> {
    const requestId = createId("human_input");

    return new Promise((resolve) => {
      let settled = false;
      const finish = (response: HumanInputToolResponse) => {
        if (settled) {
          return;
        }
        settled = true;
        input.signal?.removeEventListener("abort", cancel);
        this.pendingHumanInputs.delete(requestId);
        resolve(response);
      };
      const cancel = () => finish({ cancelled: true });
      this.pendingHumanInputs.set(requestId, {
        turnId: input.turnId,
        resolve: finish,
        cancel,
      });
      if (input.signal?.aborted) {
        finish({ cancelled: true });
        return;
      }
      input.signal?.addEventListener("abort", cancel, { once: true });
      this.emitEvent({
        type: "human.input.request",
        sessionId: input.sessionId,
        turnId: input.turnId,
        requestId,
        ...input.request,
      });
    });
  }

  private cancelHumanInputTurn(turnId: TurnId): void {
    for (const pending of this.pendingHumanInputs.values()) {
      if (pending.turnId === turnId) {
        pending.cancel();
      }
    }
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
        createdAt: this.now().toISOString(),
      });
      this.emitContextUsage(active, turnId);
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
    if (event.type === "message_end" && event.message.role === "assistant") {
      this.emitContextUsage(active, turnId);
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
      if (event.toolName === PI_TODO_TOOL_NAME && !event.isError) {
        active.metadataSync = active.metadataSync
          .then(() => this.syncTodoTasks(active.sessionId, turnId, event.result))
          .catch((error: unknown) => {
            console.warn(`Unable to synchronize PI todo state: ${formatError(error)}`);
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
      // PI notifies message_end listeners before persisting that message to its
      // SessionManager. In particular, the first response after compaction can
      // therefore report unknown usage at message_end. By agent_end the message
      // has been persisted, so emit once more to publish the recovered usage.
      this.emitContextUsage(active, turnId);
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

  private emitContextUsage(active: ActiveTurn, turnId: TurnId): void {
    const event = toContextUsageEvent({
      sessionId: active.sessionId,
      turnId,
      usage: active.piSession?.getContextUsage(),
    });
    if (event) {
      this.emitEvent(event);
    }
  }

  private async syncTodoTasks(
    sessionId: SessionId,
    turnId: TurnId,
    result: unknown,
  ): Promise<void> {
    const previousTasks = await this.sessionRepository.listTasks(sessionId);
    const tasks = toSessionTasksFromPiTodoResult({
      result,
      previousTasks,
      turnId,
      now: this.now(),
    });
    if (!tasks) {
      return;
    }
    await this.sessionRepository.replaceTasks(sessionId, tasks);
    this.emitEvent({
      type: "task.list.updated",
      sessionId,
      turnId,
      tasks,
      reason: "updated",
    });
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
      soulMode,
    ] = await Promise.all([
      this.getDeveloperMode(),
      this.getCommandExecutionMode(),
      this.getWebAccessEnabled(),
      this.getWebSearchCoverage(),
      this.getSoulMode(),
    ]);
    return {
      developerMode,
      commandExecutionMode,
      webAccessEnabled,
      webSearchCoverage,
      soulMode,
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

function toHumanInputToolResponse(response: HumanInputResponse): HumanInputToolResponse {
  return {
    ...(response.cancelled !== undefined ? { cancelled: response.cancelled } : {}),
    ...(response.answers ? { answers: response.answers } : {}),
    ...(response.remark !== undefined ? { remark: response.remark } : {}),
  };
}

function formatSoulUpdateConfirmation(reason: string, content: string): string {
  return [
    reason,
    "",
    "Proposed complete soul.md:",
    "",
    content.trim() || "(empty document)",
    "",
    "This personal context will be sent to the selected model starting with the next turn.",
  ].join("\n");
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

function deriveTitle(content: string): string {
  const firstLine = content.trim().split(/\r?\n/, 1)[0] ?? "";
  return firstLine.slice(0, 50) || "New session";
}

function readEnvSecret(primary: string, fallback: string): string | undefined {
  return process.env[primary] || process.env[fallback] || undefined;
}

export function toContextUsageEvent(input: {
  sessionId: SessionId;
  turnId: TurnId;
  usage: ContextUsage | undefined;
}): Omit<ContextUsageEvent, "eventId" | "sequence" | "occurredAt" | "agentExecutionId" | "parentAgentExecutionId"> | undefined {
  const { usage } = input;
  if (
    usage?.tokens === null
    || usage === undefined
    || !Number.isFinite(usage.tokens)
    || !Number.isFinite(usage.contextWindow)
    || usage.contextWindow <= 0
  ) {
    return undefined;
  }
  return {
    type: "context.usage",
    sessionId: input.sessionId,
    turnId: input.turnId,
    usedTokens: Math.max(0, Math.round(usage.tokens)),
    budgetTokens: Math.round(usage.contextWindow),
    windowTokens: Math.round(usage.contextWindow),
    source: "estimate",
  };
}

function toTurnOutcome(active: ActiveTurn, executionError: unknown): TurnOutcome {
  if (active.stopReason === "completed") {
    return {
      status: "completed",
      stopReason: active.stopReason,
      steps: active.steps,
    };
  }
  if (active.stopReason === "unrecoverable-error") {
    return {
      status: "error",
      stopReason: active.stopReason,
      steps: active.steps,
      error: active.errorMessage ?? formatError(executionError ?? "PI model request failed"),
    };
  }
  return {
    status: "stopped",
    stopReason: active.stopReason,
    steps: active.steps,
  };
}
