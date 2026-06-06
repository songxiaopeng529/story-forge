import type { ProviderId } from "@story-forge/model-gateway";
import { createSessionId, type SessionId, type TurnId } from "@story-forge/shared";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readJsonOrQuarantine, writeJsonAtomic } from "./atomic-json";

const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});

const persistedMessageSchema = z.discriminatedUnion("role", [
  z.object({
    id: z.string(),
    role: z.literal("user"),
    content: z.string(),
    createdAt: z.string(),
  }),
  z.object({
    id: z.string(),
    role: z.literal("assistant"),
    content: z.string(),
    reasoningContent: z.string().optional(),
    toolCalls: z.array(toolCallSchema).optional(),
    error: z.boolean().optional(),
    createdAt: z.string(),
  }),
  z.object({
    id: z.string(),
    role: z.literal("tool"),
    content: z.string(),
    name: z.string(),
    toolCallId: z.string(),
    ok: z.boolean(),
    createdAt: z.string(),
  }),
]);

const sessionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.custom<SessionId>((value) => typeof value === "string" && value.startsWith("sf_session_")),
  workspaceId: z.string(),
  title: z.string(),
  providerId: z.enum(["deepseek", "openai", "anthropic", "openrouter", "volcano"]),
  model: z.string(),
  status: z.enum(["idle", "running", "completed", "interrupted", "stopped", "error"]),
  currentTurnId: z.custom<TurnId>((value) => typeof value === "string" && value.startsWith("sf_turn_")).optional(),
  stopReason: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(persistedMessageSchema),
});

export type PersistedMessage = z.infer<typeof persistedMessageSchema>;
export type SessionRecord = z.infer<typeof sessionSchema>;
export type SessionStatus = SessionRecord["status"];

export class SessionRepository {
  private readonly sessionsDir: string;

  constructor(options: { rootDir: string }) {
    this.sessionsDir = join(options.rootDir, "sessions");
  }

  async create(input: {
    workspaceId: string;
    providerId: ProviderId;
    model: string;
    title?: string;
  }): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const session: SessionRecord = {
      schemaVersion: 1,
      id: createSessionId(),
      workspaceId: input.workspaceId,
      title: input.title ?? "New session",
      providerId: input.providerId,
      model: input.model,
      status: "idle",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    await this.write(session);
    return session;
  }

  async list(workspaceId?: string): Promise<SessionRecord[]> {
    await mkdir(this.sessionsDir, { recursive: true });
    const names = await readdir(this.sessionsDir);
    const sessions = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => this.get(name.slice(0, -5) as SessionId)),
    );
    return sessions
      .filter((session) => !workspaceId || session.workspaceId === workspaceId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(sessionId: SessionId): Promise<SessionRecord> {
    try {
      return await readJsonOrQuarantine(
        this.pathFor(sessionId),
        sessionSchema,
        `Session file is corrupt: ${sessionId}`,
      );
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        throw new Error(`Session not found: ${sessionId}`, { cause: error });
      }
      throw error;
    }
  }

  async appendMessage(sessionId: SessionId, message: PersistedMessage): Promise<SessionRecord> {
    return this.update(sessionId, (session) => ({
      ...session,
      title: session.messages.length === 0 && message.role === "user"
        ? deriveTitle(message.content)
        : session.title,
      messages: [...session.messages, message],
    }));
  }

  async replaceMessages(sessionId: SessionId, messages: PersistedMessage[]): Promise<SessionRecord> {
    return this.update(sessionId, (session) => ({ ...session, messages }));
  }

  async rename(sessionId: SessionId, title: string): Promise<SessionRecord> {
    return this.update(sessionId, (session) => ({ ...session, title: title.trim() || session.title }));
  }

  async markStatus(
    sessionId: SessionId,
    input: { status: SessionStatus; turnId?: TurnId; stopReason?: string },
  ): Promise<SessionRecord> {
    return this.update(sessionId, (session) => {
      const {
        currentTurnId: _currentTurnId,
        stopReason: _stopReason,
        ...rest
      } = session;
      return {
        ...rest,
        status: input.status,
        ...(input.turnId ? { currentTurnId: input.turnId } : {}),
        ...(input.stopReason ? { stopReason: input.stopReason } : {}),
      };
    });
  }

  async recoverInterruptedSessions(): Promise<void> {
    const sessions = await this.list();
    await Promise.all(
      sessions
        .filter((session) => session.status === "running")
        .map((session) =>
          this.markStatus(session.id, {
            status: "interrupted",
            stopReason: "application-restarted",
          }),
        ),
    );
  }

  async delete(sessionId: SessionId): Promise<void> {
    await rm(this.pathFor(sessionId), { force: true });
  }

  private async update(
    sessionId: SessionId,
    updater: (session: SessionRecord) => SessionRecord,
  ): Promise<SessionRecord> {
    const current = await this.get(sessionId);
    const updated = sessionSchema.parse({
      ...updater(current),
      updatedAt: new Date().toISOString(),
    });
    await this.write(updated);
    return updated;
  }

  private async write(session: SessionRecord): Promise<void> {
    await writeJsonAtomic(this.pathFor(session.id), sessionSchema.parse(session));
  }

  private pathFor(sessionId: SessionId): string {
    return join(this.sessionsDir, `${sessionId}.json`);
  }
}

function deriveTitle(content: string): string {
  const firstLine = content.trim().split(/\r?\n/, 1)[0] ?? "";
  return firstLine.slice(0, 50) || "New session";
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
