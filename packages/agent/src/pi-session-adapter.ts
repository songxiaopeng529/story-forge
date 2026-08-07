import {
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderId, ToolCall } from "@story-forge/shared";
import { toRecord } from "@story-forge/shared";
import type {
  LegacySessionRecord,
  PersistedMessage,
  PiSessionReferences,
  SessionMetadataRecord,
  SessionPiAdapter,
} from "./session-repository";
import type { StoryForgeWorkspaceStore } from "./host";
import type { PiModelService } from "./pi-model-service";
import { resolveStoryForgePaths } from "./storyforge-home";

type PiTextContent = { type: "text"; text: string };
type PiImageContent = { type: "image"; data: string; mimeType: string };
type PiThinkingContent = { type: "thinking"; thinking: string };
type PiToolCallContent = {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};
type PiMessage =
  | {
      role: "user";
      content: string | Array<PiTextContent | PiImageContent>;
      timestamp: number;
    }
  | {
      role: "assistant";
      content: Array<PiTextContent | PiThinkingContent | PiToolCallContent>;
      api: string;
      provider: string;
      model: string;
      usage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        totalTokens: number;
        cost: {
          input: number;
          output: number;
          cacheRead: number;
          cacheWrite: number;
          total: number;
        };
      };
      stopReason: "stop" | "toolUse" | "error" | "aborted" | "length" | "pending";
      errorMessage?: string;
      timestamp: number;
    }
  | {
      role: "toolResult";
      toolCallId: string;
      toolName: string;
      content: Array<PiTextContent | PiImageContent>;
      isError: boolean;
      timestamp: number;
    };

export class PiSessionAdapter implements SessionPiAdapter {
  private readonly rootDir: string;
  private readonly workspaces: StoryForgeWorkspaceStore;
  private readonly piModels: PiModelService;

  constructor(options: {
    rootDir: string;
    workspaces: StoryForgeWorkspaceStore;
    piModels: PiModelService;
  }) {
    this.rootDir = options.rootDir;
    this.workspaces = options.workspaces;
    this.piModels = options.piModels;
  }

  async createPiSession(input: {
    sessionId: SessionMetadataRecord["id"];
    workspaceId: string;
    providerId: ProviderId;
    model: string;
  }): Promise<PiSessionReferences> {
    const workspace = await this.workspaces.get(input.workspaceId);
    const sessionDir = this.sessionDirFor(input.workspaceId);
    await mkdir(sessionDir, { recursive: true });
    const manager = SessionManager.create(workspace.path, sessionDir, { id: input.sessionId });
    const resolvedModel = await this.piModels.resolveModel(input.providerId, input.model);
    return {
      piSessionId: manager.getSessionId(),
      piSessionFile: manager.getSessionFile() ?? "",
      providerId: resolvedModel?.provider ?? input.providerId,
      model: resolvedModel?.id ?? input.model,
    };
  }

  async migrateLegacySession(session: LegacySessionRecord): Promise<PiSessionReferences> {
    const refs = await this.createPiSession({
      sessionId: session.id,
      workspaceId: session.workspaceId,
      providerId: session.providerId,
      model: session.model,
    });
    const workspace = await this.workspaces.get(session.workspaceId);
    const manager = this.openManager({
      workspacePath: workspace.path,
      workspaceId: session.workspaceId,
      piSessionFile: refs.piSessionFile,
    });
    if (session.title.trim() && session.title !== "New session") {
      manager.appendSessionInfo(session.title);
    }
    for (const message of session.messages) {
      manager.appendMessage(toPiMessage(message, session.providerId, session.model) as Parameters<SessionManager["appendMessage"]>[0]);
    }
    return refs;
  }

  async loadMessages(session: SessionMetadataRecord): Promise<PersistedMessage[]> {
    if (!session.piSessionFile) {
      return [];
    }
    const manager = this.openManager({
      workspaceId: session.workspaceId,
      piSessionFile: session.piSessionFile,
    });
    return manager
      .buildSessionContext()
      .messages
      .map((message, index) => toStoryForgeMessage(message as PiMessage, index))
      .filter((message): message is PersistedMessage => Boolean(message));
  }

  async deletePiSession(session: SessionMetadataRecord): Promise<void> {
    if (session.piSessionFile) {
      await rm(session.piSessionFile, { force: true });
    }
  }

  async ensurePiSession(session: SessionMetadataRecord): Promise<PiSessionReferences> {
    if (session.piSessionId && session.piSessionFile) {
      return {
        piSessionId: session.piSessionId,
        piSessionFile: session.piSessionFile,
        providerId: session.providerId,
        model: session.model,
      };
    }
    return this.createPiSession({
      sessionId: session.id,
      workspaceId: session.workspaceId,
      providerId: session.providerId,
      model: session.model,
    });
  }

  async openSessionManager(session: SessionMetadataRecord): Promise<SessionManager> {
    const refs = await this.ensurePiSession(session);
    const workspace = await this.workspaces.get(session.workspaceId);
    return this.openManager({
      workspacePath: workspace.path,
      workspaceId: session.workspaceId,
      piSessionFile: refs.piSessionFile,
    });
  }

  sessionDirFor(workspaceId: string): string {
    return join(
      resolveStoryForgePaths({ homeDir: this.rootDir }).sessionTranscriptsDir,
      sanitizePathPart(workspaceId),
    );
  }

  private openManager(input: {
    workspacePath?: string;
    workspaceId: string;
    piSessionFile: string;
  }): SessionManager {
    if (!input.piSessionFile.trim()) {
      throw new Error("PI session file is missing.");
    }
    return SessionManager.open(
      input.piSessionFile,
      this.sessionDirFor(input.workspaceId),
      input.workspacePath,
    );
  }
}

function toPiMessage(message: PersistedMessage, providerId: string, model: string): PiMessage {
  const timestamp = Date.parse(message.createdAt) || Date.now();
  if (message.role === "user") {
    return {
      role: "user",
      content: [
        { type: "text", text: message.content },
        ...(message.imageAttachments ?? []).map((attachment) => ({
          type: "image" as const,
          data: attachment.data,
          mimeType: attachment.mediaType,
        })),
      ],
      timestamp,
    };
  }
  if (message.role === "assistant") {
    const toolCalls = message.toolCalls ?? [];
    return {
      role: "assistant",
      content: [
        ...(message.reasoningContent ? [{ type: "thinking" as const, thinking: message.reasoningContent }] : []),
        ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
        ...toolCalls.map((toolCall) => ({
          type: "toolCall" as const,
          id: toolCall.id,
          name: toolCall.name,
          arguments: toRecord(toolCall.input),
        })),
      ],
      api: "openai-responses",
      provider: providerId,
      model,
      usage: emptyUsage(),
      stopReason: message.error ? "error" : toolCalls.length > 0 ? "toolUse" : "stop",
      ...(message.error ? { errorMessage: message.content } : {}),
      timestamp,
    };
  }
  return {
    role: "toolResult",
    toolCallId: message.toolCallId,
    toolName: message.name,
    content: [{ type: "text", text: message.content }],
    isError: !message.ok,
    timestamp,
  };
}

function toStoryForgeMessage(message: PiMessage, index: number): PersistedMessage | undefined {
  const createdAt = new Date(message.timestamp || Date.now()).toISOString();
  if (message.role === "user") {
    const blocks = Array.isArray(message.content)
      ? message.content
      : [{ type: "text" as const, text: message.content }];
    const images = blocks.filter((block): block is PiImageContent => block.type === "image");
    return {
      id: `pi_user_${index}_${message.timestamp}`,
      role: "user",
      content: textFromBlocks(blocks),
      ...(images.length
        ? {
            imageAttachments: images.map((image, imageIndex) => ({
              id: `pi_image_${index}_${imageIndex}`,
              name: `image-${imageIndex + 1}`,
              mediaType: image.mimeType,
              data: image.data,
              size: Buffer.byteLength(image.data, "base64"),
            })),
          }
        : {}),
      createdAt,
    };
  }
  if (message.role === "assistant") {
    const toolCalls = message.content
      .filter((block): block is PiToolCallContent => block.type === "toolCall")
      .map((block) => ({
        id: block.id,
        name: block.name,
        input: block.arguments,
      } satisfies ToolCall));
    const reasoningContent = message.content
      .filter((block): block is PiThinkingContent => block.type === "thinking")
      .map((block) => block.thinking)
      .join("\n");
    const content = textFromBlocks(message.content);
    const isError = message.stopReason === "error";
    return {
      id: `pi_assistant_${index}_${message.timestamp}`,
      role: "assistant",
      content: content || (isError ? message.errorMessage ?? "PI Agent request failed." : ""),
      ...(reasoningContent ? { reasoningContent } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
      ...(isError ? { error: true } : {}),
      createdAt,
    };
  }
  if (message.role === "toolResult") {
    return {
      id: `pi_tool_${index}_${message.timestamp}`,
      role: "tool",
      content: textFromBlocks(message.content),
      name: message.toolName,
      toolCallId: message.toolCallId,
      ok: !message.isError,
      createdAt,
    };
  }
  return undefined;
}

function textFromBlocks(
  blocks: string | Array<PiTextContent | PiImageContent | PiThinkingContent | PiToolCallContent>,
): string {
  if (typeof blocks === "string") {
    return blocks;
  }
  return blocks
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if (block.type === "thinking") {
        return "";
      }
      if (block.type === "image") {
        return "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function emptyUsage(): Extract<PiMessage, { role: "assistant" }>["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_") || "default";
}
