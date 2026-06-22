import type { ProviderId, ToolCall } from "@story-forge/model-gateway";
import type {
  AgentEvent,
  AgentStopReason,
  AppSettingsView,
  AutomationRunView,
  AutomationView,
  CommandExecutionMode,
  CreateAutomationInput,
  McpConfigView,
  McpServerView,
  ResponseMode,
  ScheduleValidationResult,
  SessionId,
  SessionTask,
  SkillView,
  TurnId,
  TurnMode,
  UpdateAutomationInput,
  WebSearchCoverage,
} from "@story-forge/shared";

export const IPC_CHANNELS = {
  settingsGet: "story-forge:settings:get",
  settingsSave: "story-forge:settings:save",
  providersList: "story-forge:providers:list",
  providersSave: "story-forge:providers:save",
  providersTest: "story-forge:providers:test",
  providersClearSecret: "story-forge:providers:clear-secret",
  providersSetDefault: "story-forge:providers:set-default",
  providersDiscoverModels: "story-forge:providers:discover-models",
  workspacesList: "story-forge:workspaces:list",
  workspacesOpen: "story-forge:workspaces:open",
  workspacesRemove: "story-forge:workspaces:remove",
  sessionsList: "story-forge:sessions:list",
  sessionsCreate: "story-forge:sessions:create",
  sessionsGet: "story-forge:sessions:get",
  sessionsRename: "story-forge:sessions:rename",
  sessionsDelete: "story-forge:sessions:delete",
  turnsStart: "story-forge:turns:start",
  turnsStop: "story-forge:turns:stop",
  turnEvent: "story-forge:turns:event",
  permissionRespond: "story-forge:permissions:respond",
  automationsList: "story-forge:automations:list",
  automationsGetRuns: "story-forge:automations:get-runs",
  automationsValidateSchedule: "story-forge:automations:validate-schedule",
  automationsInterpretSchedule: "story-forge:automations:interpret-schedule",
  automationsCreate: "story-forge:automations:create",
  automationsUpdate: "story-forge:automations:update",
  automationsDelete: "story-forge:automations:delete",
  automationsRunNow: "story-forge:automations:run-now",
  skillsList: "story-forge:skills:list",
  skillsImportZip: "story-forge:skills:import-zip",
  skillsSetEnabled: "story-forge:skills:set-enabled",
  skillsRemove: "story-forge:skills:remove",
  mcpGet: "story-forge:mcp:get",
  mcpSave: "story-forge:mcp:save",
  mcpTestServer: "story-forge:mcp:test-server",
} as const;

export type ProviderView = {
  providerId: ProviderId;
  displayName: string;
  baseUrl: string;
  model: string;
  recommendedModels: string[];
  supportsImageInput: boolean;
  isDefault: boolean;
  hasSecret: boolean;
  lastTestStatus: "untested" | "success" | "failed";
  lastTestedAt?: string;
};

export type WorkspaceView = {
  id: string;
  path: string;
  displayName: string;
  createdAt: string;
  lastOpenedAt: string;
};

export type ImageAttachmentView = {
  id: string;
  name: string;
  mediaType: string;
  data: string;
  size: number;
};

export type PersistedMessageView =
  | {
      id: string;
      role: "user";
      content: string;
      imageAttachments?: ImageAttachmentView[];
      createdAt: string;
    }
  | {
      id: string;
      role: "assistant";
      content: string;
      reasoningContent?: string;
      toolCalls?: ToolCall[];
      error?: boolean;
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

export type SessionView = {
  schemaVersion: 1;
  id: SessionId;
  workspaceId: string;
  title: string;
  providerId: ProviderId;
  model: string;
  status: "idle" | "running" | "completed" | "interrupted" | "stopped" | "error";
  currentTurnId?: TurnId;
  stopReason?: string;
  createdAt: string;
  updatedAt: string;
  messages: PersistedMessageView[];
  tasks: SessionTask[];
};

export type StoryForgeApi = {
  version: string;
  settings: {
    get(): Promise<AppSettingsView>;
    save(input: {
      responseMode?: ResponseMode;
      developerMode?: boolean;
      commandExecutionMode?: CommandExecutionMode;
      webAccessEnabled?: boolean;
      webSearchCoverage?: WebSearchCoverage;
    }): Promise<AppSettingsView>;
  };
  providers: {
    list(): Promise<ProviderView[]>;
    save(input: {
      providerId: ProviderId;
      baseUrl: string;
      model: string;
      apiKey?: string;
    }): Promise<ProviderView>;
    test(providerId: ProviderId): Promise<{ models: string[] }>;
    clearSecret(providerId: ProviderId): Promise<void>;
    setDefault(providerId: ProviderId): Promise<void>;
    discoverModels(providerId: ProviderId): Promise<string[]>;
  };
  workspaces: {
    list(): Promise<WorkspaceView[]>;
    open(): Promise<WorkspaceView | undefined>;
    remove(workspaceId: string): Promise<void>;
  };
  sessions: {
    list(workspaceId?: string): Promise<SessionView[]>;
    create(input: {
      workspaceId: string;
      providerId?: ProviderId;
      model?: string;
    }): Promise<SessionView>;
    get(sessionId: SessionId): Promise<SessionView>;
    rename(sessionId: SessionId, title: string): Promise<SessionView>;
    delete(sessionId: SessionId): Promise<void>;
  };
  turns: {
    start(input: {
      sessionId: SessionId;
      prompt: string;
      mode?: TurnMode;
      imageAttachments?: ImageAttachmentView[];
    }): Promise<{ turnId: TurnId }>;
    stop(turnId: TurnId): Promise<void>;
    onEvent(listener: (event: AgentEvent) => void): () => void;
  };
  permissions: {
    respond(input: { requestId: string; approved: boolean }): Promise<void>;
  };
  automations: {
    list(): Promise<AutomationView[]>;
    getRuns(automationId: string): Promise<AutomationRunView[]>;
    validateSchedule(input: {
      cron: string;
      timezone: string;
    }): Promise<ScheduleValidationResult>;
    interpretSchedule(input: {
      scheduleText: string;
      timezone: string;
    }): Promise<ScheduleValidationResult>;
    create(input: CreateAutomationInput): Promise<AutomationView>;
    update(input: UpdateAutomationInput): Promise<AutomationView>;
    delete(automationId: string): Promise<void>;
    runNow(automationId: string): Promise<AutomationRunView>;
  };
  skills: {
    list(): Promise<SkillView[]>;
    importZip(): Promise<SkillView | undefined>;
    setEnabled(input: { skillId: string; enabled: boolean }): Promise<SkillView>;
    remove(skillId: string): Promise<void>;
  };
  mcp: {
    get(): Promise<McpConfigView>;
    save(input: { rawJson: string }): Promise<McpConfigView>;
    testServer(name: string): Promise<McpServerView>;
  };
};

export type TurnEvent = AgentEvent;
export type TurnStopReason = AgentStopReason;
