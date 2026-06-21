import type { ChatMessage, ToolCall } from "@story-forge/model-gateway";
import type { SkillView } from "@story-forge/shared";
import type {
  AgentRuntimeTurnInput,
  RuntimeContext,
  RuntimePersistedMessage,
  RuntimeSession,
  RuntimeSessionStore,
  RuntimeSettingsProvider,
  RuntimeSkillInvocation,
  RuntimeSkillResolver,
  RuntimeWorkspaceStore,
} from "./agent-runtime";

export type RuntimeContextAssemblerOptions = {
  sessionStore: RuntimeSessionStore;
  workspaceStore: RuntimeWorkspaceStore;
  settings: RuntimeSettingsProvider;
  skillResolver?: RuntimeSkillResolver;
};

export class RuntimeContextAssembler {
  private readonly sessionStore: RuntimeSessionStore;
  private readonly workspaceStore: RuntimeWorkspaceStore;
  private readonly settings: RuntimeSettingsProvider;
  private readonly skillResolver: RuntimeSkillResolver | undefined;

  constructor(options: RuntimeContextAssemblerOptions) {
    this.sessionStore = options.sessionStore;
    this.workspaceStore = options.workspaceStore;
    this.settings = options.settings;
    this.skillResolver = options.skillResolver;
  }

  async build(input: AgentRuntimeTurnInput): Promise<RuntimeContext> {
    const session = await this.sessionStore.get(input.sessionId);
    const [workspace, responseMode, developerMode, commandExecutionMode, availableSkills] =
      await Promise.all([
        this.workspaceStore.get(session.workspaceId),
        this.settings.getResponseMode(),
        this.settings.getDeveloperMode(),
        this.settings.getCommandExecutionMode(),
        this.listEnabledSkills(),
      ]);
    const activeSkillInvocation = await this.resolveSkillInvocation(input.prompt, availableSkills);
    const systemMessages = [
      createBaseSystemMessage(workspace.path),
      ...(availableSkills.length > 0 ? [createAvailableSkillsSystemMessage(availableSkills)] : []),
      ...(activeSkillInvocation ? [createSkillSystemMessage(activeSkillInvocation)] : []),
    ];

    return {
      turnId: input.turnId,
      session,
      workspace,
      settings: {
        responseMode,
        developerMode,
        commandExecutionMode,
      },
      availableSkills,
      ...(activeSkillInvocation ? { activeSkillInvocation } : {}),
      messages: [
        ...systemMessages,
        ...session.messages.map(toChatMessage),
      ],
    };
  }

  async validatePrompt(prompt: string): Promise<void> {
    const availableSkills = await this.listEnabledSkills();
    await this.resolveSkillInvocation(prompt, availableSkills);
  }

  private async listEnabledSkills(): Promise<SkillView[]> {
    const skills = (await this.skillResolver?.list?.()) ?? [];
    return skills
      .filter((skill) => skill.enabled)
      .sort((left, right) => left.invocationName.localeCompare(right.invocationName));
  }

  private async resolveSkillInvocation(
    prompt: string,
    availableSkills: SkillView[],
  ): Promise<RuntimeSkillInvocation | undefined> {
    const trimmed = prompt.trim();
    const slashInvocation = parseSlashInvocation(trimmed);
    const inferredInvocation = slashInvocation ?? inferMentionedSkillInvocation(trimmed, availableSkills);

    if (!inferredInvocation) {
      return undefined;
    }

    const skill = await this.skillResolver?.resolveInvocation(inferredInvocation.command);
    if (!skill) {
      if (slashInvocation) {
        throw new Error(`Skill not found: ${inferredInvocation.command}`);
      }
      return undefined;
    }
    if (!skill.enabled) {
      if (slashInvocation) {
        throw new Error(`Skill is disabled: ${inferredInvocation.command}`);
      }
      return undefined;
    }
    return {
      skill,
      argumentsText: inferredInvocation.argumentsText,
    };
  }
}

export function toChatMessage(message: RuntimePersistedMessage): ChatMessage {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.reasoningContent ? { reasoningContent: message.reasoningContent } : {}),
      ...(message.toolCalls?.length ? { toolCalls: message.toolCalls } : {}),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      name: message.name,
      toolCallId: message.toolCallId,
    };
  }
  return { role: "user", content: message.content };
}

export function toRuntimePersistedMessages(
  messages: ChatMessage[],
  previous: RuntimePersistedMessage[],
  toolResults: Map<string, boolean>,
  now: () => string = () => new Date().toISOString(),
): RuntimePersistedMessage[] {
  return messages
    .filter((message) => message.role !== "system")
    .map((message, index) => {
      const existing = previous[index];
      const identity = {
        id: existing?.id ?? createMessageId(),
        createdAt: existing?.createdAt ?? now(),
      };
      if (message.role === "assistant") {
        return {
          ...identity,
          role: "assistant" as const,
          content: message.content,
          ...(message.reasoningContent ? { reasoningContent: message.reasoningContent } : {}),
          ...(message.toolCalls?.length ? { toolCalls: cloneToolCalls(message.toolCalls) } : {}),
        };
      }
      if (message.role === "tool") {
        const existingOk = existing?.role === "tool" ? existing.ok : undefined;
        return {
          ...identity,
          role: "tool" as const,
          content: message.content,
          name: message.name,
          toolCallId: message.toolCallId,
          ok: toolResults.get(message.toolCallId) ?? existingOk ?? false,
        };
      }
      return {
        ...identity,
        role: "user" as const,
        content: message.content,
      };
    });
}

export type { RuntimePersistedMessage, RuntimeSession };

function createBaseSystemMessage(workspacePath: string): ChatMessage {
  return {
    role: "system",
    content:
      `You are StoryForge, a local coding agent working in ${workspacePath}. `
      + "Inspect before editing, use workspace-relative paths, and run only necessary development commands. "
      + "If the user asks for recurring or scheduled work, call automation.proposeCreate to draft an automation for user confirmation. "
      + "Use kind=thread_chat only when the user explicitly wants the automation to continue in this same chat with existing context; otherwise use kind=scheduled_chat. "
      + "Never claim the automation is created until the user confirms it.",
  };
}

function createAvailableSkillsSystemMessage(skills: SkillView[]): ChatMessage {
  return {
    role: "system",
    content: [
      "Available StoryForge skills:",
      ...skills.map((skill) =>
        `- ${skill.invocationName} (${skill.name}): ${singleLine(skill.description)}`
      ),
      "",
      "These are installed and enabled skills. Do not deny that a listed skill exists just because there is no dedicated tool with the same name.",
      "If the user explicitly invokes or mentions one of these skills, follow the matching active skill instructions when they are provided in this request.",
    ].join("\n"),
  };
}

function createSkillSystemMessage(invocation: RuntimeSkillInvocation): ChatMessage {
  return {
    role: "system",
    content: [
      `Active StoryForge skill: ${invocation.skill.name}`,
      "",
      `Invocation: ${invocation.skill.invocationName}`,
      `Arguments: ${invocation.argumentsText}`,
      "",
      "Follow this skill for the current turn. The skill instructions apply in addition to StoryForge's normal coding-agent rules. If the skill conflicts with higher-priority system instructions, follow the higher-priority instructions.",
      "If this skill describes CLI commands or command-line workflows, use StoryForge's workspace.runCommand / workspace_runCommand tool to execute those commands. Do not claim the capability is unavailable only because there is no dedicated tool named after the skill.",
      "",
      invocation.skill.body,
    ].join("\n"),
  };
}

function parseSlashInvocation(prompt: string): { command: string; argumentsText: string } | undefined {
  if (!prompt.startsWith("/")) {
    return undefined;
  }
  const [command = "", ...argumentParts] = prompt.split(/\s+/);
  if (!command || command === "/") {
    return undefined;
  }
  return {
    command,
    argumentsText: argumentParts.join(" "),
  };
}

function inferMentionedSkillInvocation(
  prompt: string,
  skills: SkillView[],
): { command: string; argumentsText: string } | undefined {
  const matches = skills.filter((skill) => promptMentionsSkill(prompt, skill));
  if (matches.length !== 1) {
    return undefined;
  }
  const skill = matches[0];
  if (!skill) {
    return undefined;
  }
  return {
    command: skill.invocationName,
    argumentsText: prompt,
  };
}

function promptMentionsSkill(prompt: string, skill: SkillView): boolean {
  return containsToken(prompt, skill.invocationName) || containsToken(prompt, skill.name);
}

function containsToken(value: string, token: string): boolean {
  if (!token.trim()) {
    return false;
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}($|[^\\p{L}\\p{N}_-])`, "iu")
    .test(value);
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cloneToolCalls(toolCalls: ToolCall[]): ToolCall[] {
  return toolCalls.map((toolCall) => ({
    ...toolCall,
    input: { ...toolCall.input },
  }));
}

function createMessageId(): string {
  return `sf_message_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
