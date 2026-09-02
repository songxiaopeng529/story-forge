import {
  type AgentSession,
  type AgentSessionEvent,
  type InlineExtension,
  type ToolDefinition as PiToolDefinition,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  createEmptyAgentExecutionUsage,
  formatError,
  toRecord,
  type AgentExecutionId,
  type AgentExecutionUsage,
  type AgentReport,
  type ChildAgentRole,
  type DelegateTaskInput,
  type ProviderId,
  type SessionId,
  type TurnId,
  type WebSearchCoverage,
} from "@story-forge/shared";
import {
  checkWorkspaceToolCall,
  createAgentReportCollector,
  normalizeAndLimitAgentReport,
  createCurrentTimeTool,
  createWebTools,
  resolveSystemTimezone,
  type RuntimeClock,
  type RuntimeTimezoneResolver,
} from "@story-forge/extensions";
import {
  CHILD_PI_BUILTIN_TOOLS,
  createStoryForgeAgentSession,
} from "../pi/create-storyforge-session";
import {
  errorMessageFromPiMessages,
  stopReasonFromPiMessages,
} from "../pi/event-mapper";
import type { PiModelService } from "../pi/pi-model-service";
import { PiExtensionUiBridge } from "../pi/pi-extension-ui";
import type { PiSessionAdapter } from "../pi/pi-session-adapter";
import { toPiToolDefinition } from "../pi/storyforge-tool-adapter";
import type { StoryForgeWorkspaceStore } from "../ports/host";
import { createRuntimeEnvironmentExtension } from "./runtime-environment";
import { formatDelegateTaskPrompt, getAgentDefinition } from "./agent-definitions";

export const CHILD_MAX_TURNS = 8;
export const CHILD_MAX_TOOL_CALLS = 40;
export const CHILD_TIMEOUT_MS = 300_000;

export type PiAgentWorkerEvent =
  | { type: "message.delta"; content: string; delivery: "live" }
  | { type: "tool.call"; callId: string; name: string; input: unknown }
  | { type: "tool.result"; callId: string; name: string; ok: boolean; output: unknown }
  | {
      type: "context.usage";
      usedTokens: number;
      budgetTokens: number;
      windowTokens: number;
      source: "estimate";
    };

export type PiAgentWorkerResult = {
  status: "completed" | "failed" | "cancelled";
  report?: AgentReport;
  error?: string;
  usage: AgentExecutionUsage;
  truncated: boolean;
  transcriptFile: string;
};

export type PiAgentWorkerRunInput = {
  sessionId: SessionId;
  workspaceId: string;
  turnId: TurnId;
  executionId: AgentExecutionId;
  role: ChildAgentRole;
  task: DelegateTaskInput;
  providerId: ProviderId;
  model: string;
  signal: AbortSignal;
  onEvent?: (event: PiAgentWorkerEvent) => void;
  onTranscriptCreated?: (transcriptFile: string) => void | Promise<void>;
};

export type PiAgentWorkerOptions = {
  workspaceRepository: StoryForgeWorkspaceStore;
  piModels: PiModelService;
  piSessions: PiSessionAdapter;
  createAgentSession?: typeof createStoryForgeAgentSession;
  getWebAccessEnabled?: () => Promise<boolean>;
  getWebSearchCoverage?: () => Promise<WebSearchCoverage>;
  now?: RuntimeClock;
  getTimezone?: RuntimeTimezoneResolver;
  maxTurns?: number;
  maxToolCalls?: number;
  timeoutMs?: number;
};

export class PiAgentWorker {
  private readonly workspaceRepository: StoryForgeWorkspaceStore;
  private readonly piModels: PiModelService;
  private readonly piSessions: PiSessionAdapter;
  private readonly createAgentSession: typeof createStoryForgeAgentSession;
  private readonly getWebAccessEnabled: () => Promise<boolean>;
  private readonly getWebSearchCoverage: () => Promise<WebSearchCoverage>;
  private readonly now: RuntimeClock;
  private readonly getTimezone: RuntimeTimezoneResolver;
  private readonly maxTurns: number;
  private readonly maxToolCalls: number;
  private readonly timeoutMs: number;

  constructor(options: PiAgentWorkerOptions) {
    this.workspaceRepository = options.workspaceRepository;
    this.piModels = options.piModels;
    this.piSessions = options.piSessions;
    this.createAgentSession = options.createAgentSession ?? createStoryForgeAgentSession;
    this.getWebAccessEnabled = options.getWebAccessEnabled ?? (async () => false);
    this.getWebSearchCoverage = options.getWebSearchCoverage ?? (async () => "focused");
    this.now = options.now ?? (() => new Date());
    this.getTimezone = options.getTimezone ?? resolveSystemTimezone;
    this.maxTurns = options.maxTurns ?? CHILD_MAX_TURNS;
    this.maxToolCalls = options.maxToolCalls ?? CHILD_MAX_TOOL_CALLS;
    this.timeoutMs = options.timeoutMs ?? CHILD_TIMEOUT_MS;
  }

  async run(input: PiAgentWorkerRunInput): Promise<PiAgentWorkerResult> {
    const workspace = await this.workspaceRepository.get(input.workspaceId);
    const model = await this.piModels.resolveModel(input.providerId, input.model);
    if (!model || model.provider !== input.providerId || model.id !== input.model) {
      throw new Error(`Child model not found: ${input.providerId}/${input.model}`);
    }
    const { sessionManager, transcriptFile } =
      await this.piSessions.createAgentExecutionSession({
        workspaceId: input.workspaceId,
        turnId: input.turnId,
        executionId: input.executionId,
      });
    await input.onTranscriptCreated?.(transcriptFile);
    const controller = new AbortController();
    let limitError: string | undefined;
    let session: AgentSession | undefined;
    let unsubscribe: (() => void) | undefined;
    let turns = 0;
    let toolCalls = 0;
    let piError: string | undefined;
    const reportCollector = createAgentReportCollector();
    const abortChild = (message?: string) => {
      if (message) {
        limitError ??= message;
      }
      if (!controller.signal.aborted) {
        controller.abort(message ? new Error(message) : input.signal.reason);
      }
      void session?.abort();
    };
    const onParentAbort = () => abortChild();
    input.signal.addEventListener("abort", onParentAbort, { once: true });
    if (input.signal.aborted) {
      abortChild();
    }
    const timeout = setTimeout(
      () => abortChild(`Child exceeded ${this.timeoutMs} ms wall-time limit`),
      this.timeoutMs,
    );
    timeout.unref?.();

    try {
      const [modelRuntime, webAccessEnabled, webSearchCoverage] = await Promise.all([
        this.piModels.getModelRuntime(),
        this.getWebAccessEnabled(),
        this.getWebSearchCoverage(),
      ]);
      const storyForgeTools = [
        createCurrentTimeTool({ now: this.now, getTimezone: this.getTimezone }),
        ...(webAccessEnabled
          ? createWebTools({
              enabled: true,
              coverage: webSearchCoverage,
              credentials: {
                tavilyApiKey: readEnvSecret("Tavily_API_KEY", "TAVILY_API_KEY"),
                serpApiKey: readEnvSecret("SerpApi_API_KEY", "SERPAPI_API_KEY"),
              },
              now: this.now,
            })
          : []),
        reportCollector.tool,
      ];
      const piTools = storyForgeTools.map(toPiToolDefinition);
      const runtimeEnvironment = createRuntimeEnvironmentExtension({
        now: this.now,
        getTimezone: this.getTimezone,
      });
      const policyExtension = this.createPolicyExtension({
        workspacePath: workspace.path,
        tools: piTools,
        getTurns: () => turns,
        incrementTurns: () => {
          turns += 1;
        },
        getToolCalls: () => toolCalls,
        incrementToolCalls: () => {
          toolCalls += 1;
        },
        abortChild,
      });
      const extensionUi = new PiExtensionUiBridge(() => undefined).createContext({
        sessionId: input.sessionId,
        turnId: input.turnId,
        signal: controller.signal,
      });
      const settingsManager = SettingsManager.inMemory({
        retry: { enabled: false },
      }, { projectTrusted: true });
      session = await this.createAgentSession({
        cwd: workspace.path,
        agentDir: this.piModels.getAgentDir(),
        modelRuntime,
        model,
        settingsManager,
        sessionManager,
        additionalExtensionPaths: [],
        additionalSkillPaths: [],
        extensionUiContext: extensionUi,
        extensionToolNames: storyForgeTools.map((tool) => tool.name),
        extensionFactories: [runtimeEnvironment.extension, policyExtension],
        systemPrompt: getAgentDefinition(input.role).systemPrompt,
        resourcePolicy: "isolated-child",
        builtInToolNames: CHILD_PI_BUILTIN_TOOLS,
      });
      const onAbort = () => {
        void session?.abort();
      };
      controller.signal.addEventListener("abort", onAbort, { once: true });
      unsubscribe = session.subscribe((event) => {
        piError = this.forwardPiEvent({
          event,
          session: session!,
          ...(input.onEvent ? { onEvent: input.onEvent } : {}),
        }) ?? piError;
      });
      try {
        if (!controller.signal.aborted) {
          await session.prompt(formatDelegateTaskPrompt({
            task: input.task,
            workspacePath: workspace.path,
          }), {
            source: "interactive",
            expandPromptTemplates: false,
          });
          await session.waitForIdle();
        }
      } finally {
        controller.signal.removeEventListener("abort", onAbort);
      }

      const usage = usageFromSession(session, turns, toolCalls);
      if (input.signal.aborted) {
        return {
          status: "cancelled",
          usage,
          truncated: false,
          transcriptFile,
        };
      }
      if (limitError || piError) {
        const childError = limitError ?? piError ?? "PI child execution failed";
        return {
          status: "failed",
          error: childError,
          usage,
          truncated: false,
          transcriptFile,
        };
      }
      const submitted = reportCollector.getLatest();
      if (submitted) {
        return {
          status: "completed",
          report: submitted.report,
          usage,
          truncated: submitted.truncated,
          transcriptFile,
        };
      }
      const fallback = normalizeAndLimitAgentReport(fallbackReport(session.messages));
      return {
        status: "completed",
        report: fallback.report,
        usage,
        truncated: fallback.truncated,
        transcriptFile,
      };
    } catch (error) {
      const usage = session
        ? usageFromSession(session, turns, toolCalls)
        : { ...createEmptyAgentExecutionUsage(), turns, toolCalls };
      if (input.signal.aborted) {
        return { status: "cancelled", usage, truncated: false, transcriptFile };
      }
      return {
        status: "failed",
        error: limitError ?? formatError(error),
        usage,
        truncated: false,
        transcriptFile,
      };
    } finally {
      clearTimeout(timeout);
      input.signal.removeEventListener("abort", onParentAbort);
      unsubscribe?.();
      session?.dispose();
    }
  }

  private createPolicyExtension(input: {
    workspacePath: string;
    tools: PiToolDefinition[];
    getTurns(): number;
    incrementTurns(): void;
    getToolCalls(): number;
    incrementToolCalls(): void;
    abortChild(message: string): void;
  }): InlineExtension {
    return {
      name: "storyforge-child-policy",
      hidden: true,
      factory: (pi) => {
        pi.on("turn_start", (_event, context) => {
          if (input.getTurns() >= this.maxTurns) {
            input.abortChild(`Child exceeded ${this.maxTurns} turn limit`);
            context.abort();
            return;
          }
          input.incrementTurns();
        });
        pi.on("tool_call", async (event, context) => {
          if (input.getToolCalls() >= this.maxToolCalls) {
            input.abortChild(`Child exceeded ${this.maxToolCalls} tool-call limit`);
            context.abort();
            return {
              block: true,
              reason: `Child exceeded ${this.maxToolCalls} tool-call limit`,
            };
          }
          input.incrementToolCalls();
          return checkWorkspaceToolCall(input.workspacePath, event.toolName, event.input);
        });
        for (const tool of input.tools) {
          pi.registerTool(tool);
        }
      },
    };
  }

  private forwardPiEvent(input: {
    event: AgentSessionEvent;
    session: AgentSession;
    onEvent?: (event: PiAgentWorkerEvent) => void;
  }): string | undefined {
    const { event, onEvent } = input;
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent as { type: string; delta?: string };
      if (update.type === "text_delta" && update.delta) {
        onEvent?.({ type: "message.delta", content: update.delta, delivery: "live" });
      }
    } else if (event.type === "tool_execution_start") {
      onEvent?.({
        type: "tool.call",
        callId: event.toolCallId,
        name: event.toolName,
        input: event.args,
      });
    } else if (event.type === "tool_execution_end") {
      onEvent?.({
        type: "tool.result",
        callId: event.toolCallId,
        name: event.toolName,
        ok: !event.isError,
        output: event.result,
      });
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      const usage = input.session.getContextUsage();
      if (usage?.tokens !== null && usage?.tokens !== undefined && usage.contextWindow > 0) {
        onEvent?.({
          type: "context.usage",
          usedTokens: Math.max(0, Math.round(usage.tokens)),
          budgetTokens: Math.round(usage.contextWindow),
          windowTokens: Math.round(usage.contextWindow),
          source: "estimate",
        });
      }
    } else if (event.type === "agent_end") {
      const stopReason = stopReasonFromPiMessages(event.messages, false);
      if (stopReason === "unrecoverable-error") {
        return errorMessageFromPiMessages(event.messages) ?? "PI child model request failed";
      }
    }
    return undefined;
  }
}

function usageFromSession(
  session: AgentSession,
  turns: number,
  toolCalls: number,
): AgentExecutionUsage {
  const stats = session.getSessionStats();
  return {
    turns,
    toolCalls,
    inputTokens: stats.tokens.input,
    outputTokens: stats.tokens.output,
    cacheReadTokens: stats.tokens.cacheRead,
    cacheWriteTokens: stats.tokens.cacheWrite,
    costUsd: stats.cost,
  };
}

function fallbackReport(messages: unknown[]): AgentReport {
  const lastAssistant = [...messages].reverse().find((message) =>
    toRecord(message).role === "assistant"
  );
  const content = toRecord(lastAssistant).content;
  const summary = Array.isArray(content)
    ? content.map((block) => {
        const record = toRecord(block);
        return record.type === "text" && typeof record.text === "string" ? record.text : "";
      }).filter(Boolean).join("\n")
    : typeof content === "string"
      ? content
      : "";
  return {
    summary: summary.trim() || "Child completed without a structured report.",
    findings: [],
    evidence: [],
    filesInspected: [],
    unresolved: [],
  };
}

function readEnvSecret(primary: string, fallback: string): string | undefined {
  return process.env[primary] || process.env[fallback] || undefined;
}
