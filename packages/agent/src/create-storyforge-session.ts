import {
  createAgentSession,
  DefaultResourceLoader,
  type AgentSession,
  type ExtensionUIContext,
  type InlineExtension,
  type ToolDefinition as PiToolDefinition,
} from "@earendil-works/pi-coding-agent";

type CreateAgentSessionOptions = NonNullable<Parameters<typeof createAgentSession>[0]>;

export type CreateStoryForgeAgentSessionInput = {
  cwd: string;
  agentDir: string;
  modelRuntime: NonNullable<CreateAgentSessionOptions["modelRuntime"]>;
  model?: CreateAgentSessionOptions["model"];
  settingsManager: NonNullable<CreateAgentSessionOptions["settingsManager"]>;
  sessionManager: NonNullable<CreateAgentSessionOptions["sessionManager"]>;
  extensionFactories: InlineExtension[];
  extensionToolNames?: string[];
  additionalSkillPaths?: string[];
  additionalExtensionPaths: string[];
  extensionUiContext: ExtensionUIContext;
  systemPrompt: string;
  onExtensionError?: (error: { error: string }) => void;
};

const PI_BUILTIN_TOOLS = ["read", "write", "edit", "bash", "grep", "find", "ls"];
const PROVIDER_SAFE_TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function createStoryForgeSystemPrompt(input: {
  extensionTools: ReadonlyArray<Pick<PiToolDefinition, "name" | "description">>;
}): string {
  const builtInTools = [
    ["read", "Read file contents"],
    ["write", "Create or completely rewrite files"],
    ["edit", "Make precise file edits using exact text replacement"],
    ["bash", "Execute shell commands in the current workspace"],
    ["grep", "Search file contents for patterns"],
    ["find", "Find files by glob pattern"],
    ["ls", "List directory contents"],
    ["todo", "Maintain a phased task plan while work is being executed"],
  ];
  const availableTools = [
    ...builtInTools.map(([name, description]) => `- ${name}: ${description}`),
    ...input.extensionTools.map((tool) => `- ${tool.name}: ${tool.description}`),
  ].join("\n");

  return [
    "You are StoryForge, an expert coding agent running inside the StoryForge desktop application.",
    "You help users understand, create, debug, and improve software directly in their workspace.",
    "Treat StoryForge as the product and runtime identity in all user-facing responses.",
    "",
    "Available tools:",
    availableTools || "(none)",
    "",
    "Guidelines:",
    "- Use read to examine files before editing them.",
    "- Use edit for precise changes and write only for new files or complete rewrites.",
    "- Respect StoryForge permission prompts and workspace boundaries.",
    "- Do not claim a tool action succeeded until its result confirms success.",
    "- Be concise and show file paths clearly when working with files.",
    "- Interpret relative dates such as today and tomorrow using the transient environment context supplied with each model request.",
    "- For latest or time-sensitive facts, use web_search and compare source publication dates instead of relying on memory.",
    "- Use the todo tool to create and maintain a phased plan for meaningful multi-step work while continuing execution with the normal tools.",
  ].join("\n");
}

export async function createStoryForgeAgentSession(
  input: CreateStoryForgeAgentSessionInput,
): Promise<AgentSession> {
  for (const name of input.extensionToolNames ?? []) {
    if (!PROVIDER_SAFE_TOOL_NAME.test(name)) {
      throw new Error(
        `Invalid tool name "${name}": tool names must start with a letter and contain only letters, numbers, underscores, or dashes`,
      );
    }
  }
  const resourceLoader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.agentDir,
    settingsManager: input.settingsManager,
    additionalExtensionPaths: input.additionalExtensionPaths,
    extensionFactories: input.extensionFactories,
    additionalSkillPaths: input.additionalSkillPaths ?? [],
    systemPromptOverride: () => input.systemPrompt,
    appendSystemPromptOverride: () => [],
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
    tools: Array.from(new Set([
      ...PI_BUILTIN_TOOLS,
      ...(input.extensionToolNames ?? []),
    ])),
  });
  await session.bindExtensions({
    mode: "rpc",
    uiContext: input.extensionUiContext,
    ...(input.onExtensionError ? { onError: input.onExtensionError } : {}),
  });
  return session;
}
