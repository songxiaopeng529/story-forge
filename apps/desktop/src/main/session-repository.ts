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

const imageAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mediaType: z.string(),
  data: z.string(),
  size: z.number().int().nonnegative(),
});

const persistedMessageSchema = z.discriminatedUnion("role", [
  z.object({
    id: z.string(),
    role: z.literal("user"),
    content: z.string(),
    imageAttachments: z.array(imageAttachmentSchema).optional(),
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
  id: z.custom<SessionId>(isValidSessionId, { message: "Invalid session id" }),
  workspaceId: z.string(),
  title: z.string(),
  providerId: z.enum(["deepseek", "openai", "anthropic", "openrouter", "volcano"]),
  model: z.string(),
  status: z.enum(["idle", "running", "completed", "interrupted", "stopped", "error"]),
  currentTurnId: z.custom<TurnId>(
    (value) => typeof value === "string" && /^sf_turn_[a-z0-9]+$/.test(value),
    { message: "Invalid turn id" },
  ).optional(),
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
  private readonly updateTails = new Map<SessionId, Promise<void>>();

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
        .filter((name) => /^sf_session_[a-z0-9]+\.json$/.test(name))
        .map(async (name) => {
          try {
            return await this.get(name.slice(0, -5) as SessionId);
          } catch (error) {
            if (isCorruptSessionError(error)) {
              return undefined;
            }
            throw error;
          }
        }),
    );
    return sessions
      .filter((session): session is SessionRecord => Boolean(session))
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
      title: session.messages.length === 0
        && session.title === "New session"
        && message.role === "user"
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
    await this.enqueueUpdate(sessionId, () => rm(this.pathFor(sessionId), { force: true }));
  }

  private async update(
    sessionId: SessionId,
    updater: (session: SessionRecord) => SessionRecord,
  ): Promise<SessionRecord> {
    return this.enqueueUpdate(sessionId, async () => {
      const current = await this.get(sessionId);
      const updated = sessionSchema.parse({
        ...updater(current),
        updatedAt: new Date().toISOString(),
      });
      await this.write(updated);
      return updated;
    });
  }

  private async write(session: SessionRecord): Promise<void> {
    await writeJsonAtomic(this.pathFor(session.id), sessionSchema.parse(session));
  }

  private pathFor(sessionId: SessionId): string {
    if (!isValidSessionId(sessionId)) {
      throw new Error(`Invalid session id: ${sessionId}`);
    }
    return join(this.sessionsDir, `${sessionId}.json`);
  }

  private enqueueUpdate<T>(sessionId: SessionId, operation: () => Promise<T>): Promise<T> {
    const previous = this.updateTails.get(sessionId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.updateTails.set(sessionId, tail);
    void tail.finally(() => {
      if (this.updateTails.get(sessionId) === tail) {
        this.updateTails.delete(sessionId);
      }
    });
    return result;
  }
}

function deriveTitle(content: string): string {
  const firstLine = content.trim().split(/\r?\n/, 1)[0] ?? "";
  return firstLine.slice(0, 50) || "New session";
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function isValidSessionId(value: unknown): value is SessionId {
  return typeof value === "string" && /^sf_session_[a-z0-9]+$/.test(value);
}

function isCorruptSessionError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Session file is corrupt:");
}
