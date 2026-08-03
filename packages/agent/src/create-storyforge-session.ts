import {
  createAgentSession,
  DefaultResourceLoader,
  type AgentSession,
  type InlineExtension,
  type ToolDefinition as PiToolDefinition,
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
  extensionToolNames?: string[];
  additionalSkillPaths?: string[];
  systemPrompt: string;
  onExtensionError?: (error: { error: string }) => void;
};

const PI_BUILTIN_TOOLS = ["read", "write", "edit", "bash", "grep", "find", "ls"];
const PI_PLAN_TOOLS = ["read", "grep", "find", "ls"];
const PROVIDER_SAFE_TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function createStoryForgeSystemPrompt(input: {
  mode: TurnMode;
  extensionTools: ReadonlyArray<Pick<PiToolDefinition, "name" | "description">>;
}): string {
  const builtInTools = input.mode === "plan"
    ? [
        ["read", "Read file contents"],
        ["grep", "Search file contents for patterns"],
        ["find", "Find files by glob pattern"],
        ["ls", "List directory contents"],
      ]
    : [
        ["read", "Read file contents"],
        ["write", "Create or completely rewrite files"],
        ["edit", "Make precise file edits using exact text replacement"],
        ["bash", "Execute shell commands in the current workspace"],
        ["grep", "Search file contents for patterns"],
        ["find", "Find files by glob pattern"],
        ["ls", "List directory contents"],
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
    input.mode === "plan"
      ? "- This turn is in plan mode: inspect and reason, but do not modify files or run mutation commands."
      : "- Use the StoryForge task tools when tracking meaningful multi-step implementation work.",
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
      ...(input.mode === "plan" ? PI_PLAN_TOOLS : PI_BUILTIN_TOOLS),
      ...(input.extensionToolNames ?? []),
    ])),
  });
  await session.bindExtensions({
    mode: "print",
    ...(input.onExtensionError ? { onError: input.onExtensionError } : {}),
  });
  return session;
}
