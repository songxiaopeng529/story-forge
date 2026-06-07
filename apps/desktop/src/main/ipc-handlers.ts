import type { ProviderId } from "@story-forge/model-gateway";
import type { SessionId, TurnId } from "@story-forge/shared";
import { z } from "zod";
import { IPC_CHANNELS } from "../shared/story-forge-api";
import type { AgentCoordinator } from "./agent-coordinator";
import type { ProviderService } from "./provider-service";
import type { SessionRepository } from "./session-repository";
import type { WorkspaceRepository } from "./workspace-repository";

type IpcHandler = (event: unknown, input: unknown) => unknown;

export type IpcRegistrar = {
  handle(channel: string, listener: IpcHandler): void;
  removeHandler?(channel: string): void;
};

export type IpcHandlerOptions = {
  ipc: IpcRegistrar;
  providers: ProviderService;
  workspaces: WorkspaceRepository;
  sessions: SessionRepository;
  coordinator: AgentCoordinator;
  selectWorkspace: () => Promise<string | undefined>;
};

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

export function registerIpcHandlers(options: IpcHandlerOptions): void {
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
    z.object({ sessionId: sessionIdSchema, prompt: z.string().min(1) }),
    (input) => options.coordinator.start(input),
  );
  handle(options.ipc, IPC_CHANNELS.turnsStop, turnIdSchema, (turnId) =>
    options.coordinator.stop(turnId)
  );
}

function handle<Schema extends z.ZodType>(
  ipc: IpcRegistrar,
  channel: string,
  schema: Schema,
  listener: (input: z.infer<Schema>) => unknown,
): void {
  ipc.removeHandler?.(channel);
  ipc.handle(channel, (_event, input) => listener(schema.parse(input)));
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
