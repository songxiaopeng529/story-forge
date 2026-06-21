import type {
  ChatMessage,
  ModelProvider,
  ProviderConnectionConfig,
  ProviderId,
  ToolCall,
} from "@story-forge/model-gateway";
import type {
  AgentEvent,
  CommandExecutionMode,
  InstalledSkillRecord,
  ResponseMode,
  SessionId,
  SkillView,
  TurnId,
} from "@story-forge/shared";
import type { ToolRegistry } from "@story-forge/tools";

export interface AgentRuntime {
  runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentEvent>;
}

export type AgentRuntimeTurnInput = {
  sessionId: SessionId;
  turnId: TurnId;
  prompt: string;
  signal?: AbortSignal;
};

export type RuntimePersistedMessage =
  | {
      id: string;
      role: "user";
      content: string;
      createdAt: string;
    }
  | {
      id: string;
      role: "assistant";
      content: string;
      reasoningContent?: string | undefined;
      toolCalls?: ToolCall[] | undefined;
      error?: boolean | undefined;
      createdAt: string;
    }
  | {
      id: string;
      role: "tool";
      content: string;
      name: string;
      toolCallId: string;
      ok: boolean;
      createdAt: string;
    };

export type RuntimeSession = {
  id: SessionId;
  workspaceId: string;
  providerId: ProviderId;
  model: string;
  messages: RuntimePersistedMessage[];
};

export type RuntimeWorkspace = {
  id: string;
  path: string;
};

export type RuntimeSettings = {
  responseMode: ResponseMode;
  developerMode: boolean;
  commandExecutionMode: CommandExecutionMode;
};

export type RuntimeSkillInvocation = {
  skill: InstalledSkillRecord;
  argumentsText: string;
};

export type RuntimeContext = {
  turnId: TurnId;
  session: RuntimeSession;
  workspace: RuntimeWorkspace;
  settings: RuntimeSettings;
  availableSkills: SkillView[];
  activeSkillInvocation?: RuntimeSkillInvocation;
  messages: ChatMessage[];
};

export type RuntimeSessionStore = {
  get(sessionId: SessionId): Promise<RuntimeSession>;
  replaceMessages?(
    sessionId: SessionId,
    messages: RuntimePersistedMessage[],
  ): Promise<RuntimeSession>;
};

export type RuntimeWorkspaceStore = {
  get(workspaceId: string): Promise<RuntimeWorkspace>;
};

export type RuntimeSettingsProvider = {
  getResponseMode(): Promise<ResponseMode>;
  getDeveloperMode(): Promise<boolean>;
  getCommandExecutionMode(): Promise<CommandExecutionMode>;
};

export type RuntimeSkillResolver = {
  list?(): Promise<SkillView[]>;
  resolveInvocation(command: string): Promise<InstalledSkillRecord | undefined>;
};

export type RuntimeProviderResolver = {
  resolve(providerId: ProviderId): Promise<ProviderConnectionConfig & { apiKey: string }>;
};

export type RuntimeProviderFactory = {
  createProvider(config: ProviderConnectionConfig, apiKey: string): ModelProvider;
};

export type RuntimeToolFactoryHelpers = {
  signal?: AbortSignal;
  emit(event: AgentEvent): void | Promise<void>;
};

export type RuntimeToolFactory = {
  createTools(
    context: RuntimeContext,
    helpers: RuntimeToolFactoryHelpers,
  ): ToolRegistry | Promise<ToolRegistry>;
};
