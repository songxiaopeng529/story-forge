import type { ProviderId } from "@story-forge/model-gateway";
import type { SessionId, TurnId } from "@story-forge/shared";
import { z } from "zod";
import { IPC_CHANNELS } from "../shared/story-forge-api";
import type { AgentCoordinator } from "./agent-coordinator";
import type { AppSettingsStore } from "./app-settings-store";
import type { McpConfigService } from "./mcp-config-service";
import type { ProviderService } from "./provider-service";
import type { SessionRepository } from "./session-repository";
import type { SkillService } from "./skill-service";
import type { WorkspaceRepository } from "./workspace-repository";

type IpcHandler = (event: unknown, input: unknown) => unknown;

export type IpcRegistrar = {
  handle(channel: string, listener: IpcHandler): void;
  removeHandler?(channel: string): void;
};

type SkillsIpcService = Pick<SkillService, "list" | "importZip" | "setEnabled" | "remove">;
type McpIpcService = Pick<McpConfigService, "get" | "saveRawJson" | "testServer">;
type AutomationsIpcService = {
  list(): unknown;
  getRuns(automationId: string): unknown;
  validateSchedule(input: { cron: string; timezone: string }): unknown;
  interpretSchedule(input: { scheduleText: string; timezone: string }): unknown;
  create(input: z.infer<typeof automationCreateSchema>): unknown;
  update(input: z.infer<typeof automationUpdateSchema>): unknown;
  delete(automationId: string): unknown;
  runNow(automationId: string): unknown;
};

export type IpcHandlerOptions = {
  ipc: IpcRegistrar;
  providers: ProviderService;
  workspaces: WorkspaceRepository;
  sessions: SessionRepository;
  settings: AppSettingsStore;
  coordinator: AgentCoordinator;
  selectWorkspace: () => Promise<string | undefined>;
  skills: SkillsIpcService;
  mcp: McpIpcService;
  automations: AutomationsIpcService;
  selectSkillArchive: () => Promise<string | undefined>;
};

const responseModeSchema = z.enum(["auto", "live", "smooth"]);
const turnModeSchema = z.enum(["normal", "plan"]);
const commandExecutionModeSchema = z.enum(["sentinel", "cruise", "unleashed"]);
const webSearchCoverageSchema = z.enum(["focused", "wide"]);
const providerIdSchema = z.enum([
  "deepseek",
  "openai",
  "anthropic",
  "openrouter",
  "volcano",
]);
const sessionIdSchema = z.custom<SessionId>(
  (value) => typeof value === "string" && /^sf_session_[a-z0-9]+$/.test(value),
  { message: "Invalid session id" },
);
const turnIdSchema = z.custom<TurnId>(
  (value) => typeof value === "string" && /^sf_turn_[a-z0-9]+$/.test(value),
  { message: "Invalid turn id" },
);
const workspaceIdSchema = z.string().min(1);
const imageAttachmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mediaType: z.string().min(1),
  data: z.string().min(1),
  size: z.number().int().nonnegative(),
});
const settingsSaveSchema = z.object({
  responseMode: responseModeSchema.optional(),
  developerMode: z.boolean().optional(),
  commandExecutionMode: commandExecutionModeSchema.optional(),
  webAccessEnabled: z.boolean().optional(),
  webSearchCoverage: webSearchCoverageSchema.optional(),
});
const permissionResponseSchema = z.object({
  requestId: z.string().min(1),
  approved: z.boolean(),
});
const skillIdSchema = z.string().min(1);
const skillEnabledSchema = z.object({
  skillId: skillIdSchema,
  enabled: z.boolean(),
});
const mcpSaveSchema = z.object({
  rawJson: z.string().min(1),
});
const mcpServerNameSchema = z.string().min(1);
const automationIdSchema = z.string().min(1);
const automationStatusSchema = z.enum(["active", "paused"]);
const automationKindSchema = z.enum(["scheduled_chat", "thread_chat"]);
const automationProviderIdSchema = providerIdSchema;
const automationSessionIdSchema = z.custom<`sf_session_${string}`>(
  (value) => typeof value === "string" && /^sf_session_[a-z0-9]+$/.test(value),
  { message: "Invalid session id" },
);
const automationScheduleSchema = z.object({
  sourceText: z.string(),
  cron: z.string().min(1),
  timezone: z.string().min(1),
  summary: z.string(),
});
const automationCreateSchema = z.object({
  name: z.string().min(1),
  kind: automationKindSchema.optional(),
  status: automationStatusSchema,
  workspaceId: workspaceIdSchema,
  providerId: automationProviderIdSchema,
  model: z.string().min(1),
  sessionId: automationSessionIdSchema.optional(),
  schedule: automationScheduleSchema,
  prompt: z.string().min(1),
});
const automationUpdateSchema = z.object({
  automationId: automationIdSchema,
  kind: automationKindSchema.optional(),
  name: z.string().min(1).optional(),
  status: automationStatusSchema.optional(),
  workspaceId: workspaceIdSchema.optional(),
  providerId: automationProviderIdSchema.optional(),
  model: z.string().min(1).optional(),
  sessionId: automationSessionIdSchema.optional(),
  schedule: automationScheduleSchema.optional(),
  prompt: z.string().min(1).optional(),
});
const automationValidateScheduleSchema = z.object({
  cron: z.string().min(1),
  timezone: z.string().min(1),
});
const automationInterpretScheduleSchema = z.object({
  scheduleText: z.string().min(1),
  timezone: z.string().min(1),
});

export function registerIpcHandlers(options: IpcHandlerOptions): void {
  handle(options.ipc, IPC_CHANNELS.settingsGet, z.undefined(), () =>
    options.settings.get()
  );
  handle(
    options.ipc,
    IPC_CHANNELS.settingsSave,
    settingsSaveSchema,
    (input) => options.settings.save(input),
  );
  handle(options.ipc, IPC_CHANNELS.providersList, z.undefined(), () =>
    options.providers.list()
  );
  handle(
    options.ipc,
    IPC_CHANNELS.providersSave,
    z.object({
      providerId: providerIdSchema,
      baseUrl: z.string().min(1),
      model: z.string().min(1),
      apiKey: z.string().optional(),
    }),
    (input) => options.providers.save({
      providerId: input.providerId,
      baseUrl: input.baseUrl,
      model: input.model,
      ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
    }),
  );
  handle(options.ipc, IPC_CHANNELS.providersTest, providerIdSchema, (providerId) =>
    options.providers.test(providerId)
  );
  handle(
    options.ipc,
    IPC_CHANNELS.providersClearSecret,
    providerIdSchema,
    (providerId) => options.providers.clearSecret(providerId),
  );
  handle(
    options.ipc,
    IPC_CHANNELS.providersSetDefault,
    providerIdSchema,
    (providerId) => options.providers.setDefault(providerId),
  );
  handle(
    options.ipc,
    IPC_CHANNELS.providersDiscoverModels,
    providerIdSchema,
    (providerId) => options.providers.discoverModels(providerId),
  );
  handle(options.ipc, IPC_CHANNELS.workspacesList, z.undefined(), () =>
    options.workspaces.list()
  );
  handle(options.ipc, IPC_CHANNELS.workspacesOpen, z.undefined(), async () => {
    const selectedPath = await options.selectWorkspace();
    return selectedPath ? options.workspaces.open(selectedPath) : undefined;
  });
  handle(options.ipc, IPC_CHANNELS.workspacesRemove, workspaceIdSchema, (workspaceId) =>
    options.workspaces.remove(workspaceId)
  );
  handle(
    options.ipc,
    IPC_CHANNELS.sessionsList,
    z.object({ workspaceId: workspaceIdSchema.optional() }),
    ({ workspaceId }) => options.sessions.list(workspaceId),
  );
  handle(
    options.ipc,
    IPC_CHANNELS.sessionsCreate,
    z.object({
      workspaceId: workspaceIdSchema,
      providerId: providerIdSchema.optional(),
      model: z.string().min(1).optional(),
    }),
    async (input) => {
      const provider = await selectProvider(options.providers, input.providerId);
      return options.sessions.create({
        workspaceId: input.workspaceId,
        providerId: provider.providerId,
        model: input.model ?? provider.model,
      });
    },
  );
  handle(options.ipc, IPC_CHANNELS.sessionsGet, sessionIdSchema, (sessionId) =>
    options.sessions.get(sessionId)
  );
  handle(
    options.ipc,
    IPC_CHANNELS.sessionsRename,
    z.object({ sessionId: sessionIdSchema, title: z.string().min(1) }),
    ({ sessionId, title }) => options.sessions.rename(sessionId, title),
  );
  handle(options.ipc, IPC_CHANNELS.sessionsDelete, sessionIdSchema, async (sessionId) => {
    const session = await options.sessions.get(sessionId);
    if (session.status === "running") {
      throw new Error("Cannot delete a running session");
    }
    await options.sessions.delete(sessionId);
  });
  handle(
    options.ipc,
    IPC_CHANNELS.turnsStart,
    z.object({
      sessionId: sessionIdSchema,
      prompt: z.string(),
      mode: turnModeSchema.optional(),
      imageAttachments: z.array(imageAttachmentSchema).optional(),
    }).refine((input) => input.prompt.trim() || input.imageAttachments?.length, {
      message: "Prompt or image attachment is required",
    }),
    (input) => options.coordinator.start({
      sessionId: input.sessionId,
      prompt: input.prompt,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.imageAttachments ? { imageAttachments: input.imageAttachments } : {}),
    }),
  );
  handle(options.ipc, IPC_CHANNELS.turnsStop, turnIdSchema, (turnId) =>
    options.coordinator.stop(turnId)
  );
  handle(options.ipc, IPC_CHANNELS.turnsCompact, sessionIdSchema, (sessionId) =>
    options.coordinator.compactSession(sessionId)
  );
  handle(
    options.ipc,
    IPC_CHANNELS.permissionRespond,
    permissionResponseSchema,
    (input) => options.coordinator.respondToPermission(input),
  );
  handle(options.ipc, IPC_CHANNELS.automationsList, z.undefined(), () =>
    options.automations.list()
  );
  handle(
    options.ipc,
    IPC_CHANNELS.automationsGetRuns,
    automationIdSchema,
    (automationId) => options.automations.getRuns(automationId),
  );
  handle(
    options.ipc,
    IPC_CHANNELS.automationsValidateSchedule,
    automationValidateScheduleSchema,
    (input) => options.automations.validateSchedule(input),
  );
  handle(
    options.ipc,
    IPC_CHANNELS.automationsInterpretSchedule,
    automationInterpretScheduleSchema,
    (input) => options.automations.interpretSchedule(input),
  );
  handle(
    options.ipc,
    IPC_CHANNELS.automationsCreate,
    automationCreateSchema,
    (input) => options.automations.create(input),
  );
  handle(
    options.ipc,
    IPC_CHANNELS.automationsUpdate,
    automationUpdateSchema,
    (input) => options.automations.update(input),
  );
  handle(
    options.ipc,
    IPC_CHANNELS.automationsDelete,
    automationIdSchema,
    (automationId) => options.automations.delete(automationId),
  );
  handle(
    options.ipc,
    IPC_CHANNELS.automationsRunNow,
    automationIdSchema,
    (automationId) => options.automations.runNow(automationId),
  );
  handle(options.ipc, IPC_CHANNELS.skillsList, z.undefined(), () =>
    options.skills.list()
  );
  handle(options.ipc, IPC_CHANNELS.skillsImportZip, z.undefined(), async () => {
    const archivePath = await options.selectSkillArchive();
    return archivePath ? options.skills.importZip(archivePath) : undefined;
  });
  handle(
    options.ipc,
    IPC_CHANNELS.skillsSetEnabled,
    skillEnabledSchema,
    (input) => options.skills.setEnabled(input.skillId, input.enabled),
  );
  handle(options.ipc, IPC_CHANNELS.skillsRemove, skillIdSchema, (skillId) =>
    options.skills.remove(skillId)
  );
  handle(options.ipc, IPC_CHANNELS.mcpGet, z.undefined(), () =>
    options.mcp.get()
  );
  handle(options.ipc, IPC_CHANNELS.mcpSave, mcpSaveSchema, (input) =>
    options.mcp.saveRawJson(input.rawJson)
  );
  handle(options.ipc, IPC_CHANNELS.mcpTestServer, mcpServerNameSchema, (name) =>
    options.mcp.testServer(name)
  );
}

function handle<Schema extends z.ZodType>(
  ipc: IpcRegistrar,
  channel: string,
  schema: Schema,
  listener: (input: z.infer<Schema>) => unknown,
): void {
  ipc.removeHandler?.(channel);
  ipc.handle(channel, (_event, input) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      throw new Error("Invalid IPC payload");
    }
    return listener(parsed.data);
  });
}

async function selectProvider(
  providers: ProviderService,
  providerId: ProviderId | undefined,
) {
  const available = await providers.list();
  const selected = providerId
    ? available.find((provider) => provider.providerId === providerId)
    : available.find((provider) => provider.isDefault);
  if (!selected) {
    throw new Error(providerId
      ? `Provider configuration not found: ${providerId}`
      : "No default provider configured");
  }
  if (!selected.model) {
    throw new Error(`No model configured for ${selected.displayName}`);
  }
  return selected;
}
