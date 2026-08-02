import {
  createAgentSession,
  DefaultResourceLoader,
  type AgentSession,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import type { TurnMode } from "@story-forge/shared";

type CreateAgentSessionOptions = NonNullable<Parameters<typeof createAgentSession>[0]>;

export type CreateStoryForgeAgentSessionInput = {
  cwd: string;
  agentDir: string;
  modelRuntime: NonNullable<CreateAgentSessionOptions["modelRuntime"]>;
  model?: CreateAgentSessionOptions["model"];
  settingsManager: NonNullable<CreateAgentSessionOptions["settingsManager"]>;
  sessionManager: NonNullable<CreateAgentSessionOptions["sessionManager"]>;
  mode: TurnMode;
  extensionFactories: InlineExtension[];
  appendSystemPrompt: string[];
  onExtensionError?: (error: { error: string }) => void;
};

const PI_BUILTIN_TOOLS = ["read", "write", "edit", "bash", "grep", "find", "ls"];
const PI_PLAN_TOOLS = ["read", "grep", "find", "ls"];

export async function createStoryForgeAgentSession(
  input: CreateStoryForgeAgentSessionInput,
): Promise<AgentSession> {
  const resourceLoader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.agentDir,
    settingsManager: input.settingsManager,
    extensionFactories: input.extensionFactories,
    appendSystemPrompt: input.appendSystemPrompt,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: input.cwd,
    agentDir: input.agentDir,
    modelRuntime: input.modelRuntime,
    ...(input.model ? { model: input.model } : {}),
    settingsManager: input.settingsManager,
    resourceLoader,
    sessionManager: input.sessionManager,
    tools: input.mode === "plan" ? PI_PLAN_TOOLS : PI_BUILTIN_TOOLS,
  });
  await session.bindExtensions({
    mode: "print",
    ...(input.onExtensionError ? { onError: input.onExtensionError } : {}),
  });
  return session;
}
