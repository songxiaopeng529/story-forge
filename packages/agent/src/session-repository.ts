import {
  createSessionId,
  createTaskId,
  type SessionId,
  type SessionTask,
  type TaskId,
  type TaskStatus,
  type TurnId,
} from "@story-forge/shared";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ProviderId } from "@story-forge/shared";
import { readJsonOrQuarantine, writeJsonAtomic } from "./atomic-json";

const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

const imageAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mediaType: z.string(),
  data: z.string(),
  size: z.number().int().nonnegative(),
});

const turnIdSchema = z.custom<TurnId>(
  (value) => typeof value === "string" && /^sf_turn_[a-z0-9]+$/.test(value),
  { message: "Invalid turn id" },
);

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
    kind: z.enum(["summary"]).optional(),
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

const taskIdSchema = z.custom<TaskId>(
  (value) => typeof value === "string" && /^sf_task_[a-z0-9]+$/.test(value),
  { message: "Invalid task id" },
);

const sessionTaskSchema = z.object({
  id: taskIdSchema,
  title: z.string(),
  description: z.string().optional(),
  activeForm: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]),
  blockedReason: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdTurnId: turnIdSchema.optional(),
  updatedTurnId: turnIdSchema.optional(),
});

const sessionStatusSchema = z.enum([
  "idle",
  "running",
  "completed",
  "interrupted",
  "stopped",
  "error",
]);

const legacySessionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.custom<SessionId>(isValidSessionId, { message: "Invalid session id" }),
  workspaceId: z.string(),
  title: z.string(),
  providerId: z.string(),
  model: z.string(),
  status: sessionStatusSchema,
  currentTurnId: turnIdSchema.optional(),
  stopReason: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(persistedMessageSchema),
  tasks: z.array(sessionTaskSchema).default([]),
});

const sessionMetadataSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.custom<SessionId>(isValidSessionId, { message: "Invalid session id" }),
  workspaceId: z.string(),
  title: z.string(),
  providerId: z.string(),
  model: z.string(),
  status: sessionStatusSchema,
  currentTurnId: turnIdSchema.optional(),
  stopReason: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tasks: z.array(sessionTaskSchema).default([]),
  piSessionId: z.string().optional(),
  piSessionFile: z.string().optional(),
  migrationStatus: z.enum(["ok", "failed"]).optional(),
  migrationError: z.string().optional(),
});

const readableSessionSchema = z.union([sessionMetadataSchema, legacySessionSchema]);

export type PersistedMessage = z.infer<typeof persistedMessageSchema>;
export type LegacySessionRecord = z.infer<typeof legacySessionSchema>;
export type SessionMetadataRecord = z.infer<typeof sessionMetadataSchema>;
export type SessionRecord = SessionMetadataRecord & { messages: PersistedMessage[] };
export type SessionStatus = SessionMetadataRecord["status"];
export type CreateTaskInput = {
  title: string;
  description?: string;
  activeForm?: string;
  turnId?: TurnId;
};
export type UpdateTaskInput = {
  taskId: TaskId;
  title?: string;
  description?: string;
  activeForm?: string;
  status?: TaskStatus;
  blockedReason?: string;
  turnId?: TurnId;
};

export type PiSessionReferences = {
  piSessionId: string;
  piSessionFile: string;
  providerId?: ProviderId;
  model?: string;
};

export type SessionPiAdapter = {
  createPiSession(input: {
    sessionId: SessionId;
    workspaceId: string;
    providerId: ProviderId;
    model: string;
  }): Promise<PiSessionReferences>;
  migrateLegacySession(session: LegacySessionRecord): Promise<PiSessionReferences>;
  loadMessages(session: SessionMetadataRecord): Promise<PersistedMessage[]>;
  deletePiSession(session: SessionMetadataRecord): Promise<void>;
};

export class SessionRepository {
  private readonly sessionsDir: string;
  private readonly piAdapter: SessionPiAdapter | undefined;
  private readonly updateTails = new Map<SessionId, Promise<void>>();

  constructor(options: { rootDir: string; piAdapter?: SessionPiAdapter }) {
    this.sessionsDir = join(options.rootDir, "sessions");
    this.piAdapter = options.piAdapter;
  }

  async create(input: {
    workspaceId: string;
    providerId: ProviderId;
    model: string;
    title?: string;
  }): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const id = createSessionId();
    const piRefs = await this.piAdapter?.createPiSession({
      sessionId: id,
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      model: input.model,
    });
    const session: SessionMetadataRecord = sessionMetadataSchema.parse({
      schemaVersion: 2,
      id,
      workspaceId: input.workspaceId,
      title: input.title ?? "New session",
      providerId: piRefs?.providerId ?? input.providerId,
      model: piRefs?.model ?? input.model,
      status: "idle",
      createdAt: now,
      updatedAt: now,
      tasks: [],
      ...(piRefs?.piSessionId ? { piSessionId: piRefs.piSessionId } : {}),
      ...(piRefs?.piSessionFile ? { piSessionFile: piRefs.piSessionFile } : {}),
      migrationStatus: "ok",
    });
    await this.write(session);
    return this.materialize(session);
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
    const session = await this.readMetadata(sessionId);
    return this.materialize(session);
  }

  async appendMessage(_sessionId: SessionId, _message: PersistedMessage): Promise<SessionRecord> {
    throw new Error("Session messages are managed by PI Agent.");
  }

  async replaceMessages(_sessionId: SessionId, _messages: PersistedMessage[]): Promise<SessionRecord> {
    throw new Error("Session messages are managed by PI Agent.");
  }

  async attachPiSession(
    sessionId: SessionId,
    refs: PiSessionReferences,
  ): Promise<SessionRecord> {
    return this.update(sessionId, (session) => ({
      ...session,
      piSessionId: refs.piSessionId,
      piSessionFile: refs.piSessionFile,
      providerId: refs.providerId ?? session.providerId,
      model: refs.model ?? session.model,
      migrationStatus: "ok",
    }));
  }

  async listTasks(sessionId: SessionId): Promise<SessionTask[]> {
    const session = await this.readMetadata(sessionId);
    return session.tasks;
  }

  async createTask(sessionId: SessionId, input: CreateTaskInput): Promise<SessionRecord> {
    const title = input.title.trim();
    if (!title) {
      throw new Error("Task title must not be empty");
    }

    return this.update(sessionId, (session) => {
      const now = new Date().toISOString();
      const task: SessionTask = {
        id: createTaskId(),
        title,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        ...(trimOptional(input.description) ? { description: trimOptional(input.description) } : {}),
        ...(trimOptional(input.activeForm) ? { activeForm: trimOptional(input.activeForm) } : {}),
        ...(input.turnId ? { createdTurnId: input.turnId, updatedTurnId: input.turnId } : {}),
      };
      return { ...session, tasks: [...session.tasks, task] };
    });
  }

  async updateTask(sessionId: SessionId, input: UpdateTaskInput): Promise<SessionRecord> {
    return this.update(sessionId, (session) => {
      const index = session.tasks.findIndex((task) => task.id === input.taskId);
      if (index < 0) {
        throw new Error(`Task not found: ${input.taskId}`);
      }
      if (input.status === "blocked" && !trimOptional(input.blockedReason)) {
        throw new Error("Blocked tasks require a blockedReason");
      }

      const now = new Date().toISOString();
      const tasks = session.tasks.map((task, taskIndex) => {
        if (input.status === "in_progress" && taskIndex !== index && task.status === "in_progress") {
          return applyTaskPatch(task, {
            status: "pending",
            updatedAt: now,
            ...(input.turnId ? { updatedTurnId: input.turnId } : {}),
          });
        }
        if (taskIndex !== index) {
          return task;
        }
        return updateTaskRecord(task, input, now);
      });
      return { ...session, tasks };
    });
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
    const session = await this.readMetadata(sessionId);
    await this.piAdapter?.deletePiSession(session);
    await this.enqueueUpdate(sessionId, () => rm(this.pathFor(sessionId), { force: true }));
  }

  private async readMetadata(sessionId: SessionId): Promise<SessionMetadataRecord> {
    try {
      const parsed = await readJsonOrQuarantine(
        this.pathFor(sessionId),
        readableSessionSchema,
        `Session file is corrupt: ${sessionId}`,
      );
      if (parsed.schemaVersion === 2) {
        return parsed;
      }
      return this.migrateLegacyMetadata(parsed);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        throw new Error(`Session not found: ${sessionId}`, { cause: error });
      }
      throw error;
    }
  }

  private async migrateLegacyMetadata(legacy: LegacySessionRecord): Promise<SessionMetadataRecord> {
    const base: SessionMetadataRecord = sessionMetadataSchema.parse({
      schemaVersion: 2,
      id: legacy.id,
      workspaceId: legacy.workspaceId,
      title: legacy.title,
      providerId: legacy.providerId,
      model: legacy.model,
      status: legacy.status,
      ...(legacy.currentTurnId ? { currentTurnId: legacy.currentTurnId } : {}),
      ...(legacy.stopReason ? { stopReason: legacy.stopReason } : {}),
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
      tasks: legacy.tasks,
    });

    if (!this.piAdapter) {
      return base;
    }

    try {
      const refs = await this.piAdapter.migrateLegacySession(legacy);
      const migrated = sessionMetadataSchema.parse({
        ...base,
        piSessionId: refs.piSessionId,
        piSessionFile: refs.piSessionFile,
        providerId: refs.providerId ?? legacy.providerId,
        model: refs.model ?? legacy.model,
        migrationStatus: "ok",
      });
      await this.write(migrated);
      return migrated;
    } catch (error) {
      const failed = sessionMetadataSchema.parse({
        ...base,
        status: "error",
        stopReason: "migration-failed",
        migrationStatus: "failed",
        migrationError: error instanceof Error ? error.message : String(error),
      });
      await this.write(failed);
      return failed;
    }
  }

  private async materialize(session: SessionMetadataRecord): Promise<SessionRecord> {
    const messages = session.migrationStatus === "failed"
      ? []
      : await this.piAdapter?.loadMessages(session) ?? [];
    return {
      ...session,
      messages,
    };
  }

  private async update(
    sessionId: SessionId,
    updater: (session: SessionMetadataRecord) => SessionMetadataRecord,
  ): Promise<SessionRecord> {
    return this.enqueueUpdate(sessionId, async () => {
      const current = await this.readMetadata(sessionId);
      const updated = sessionMetadataSchema.parse({
        ...updater(current),
        updatedAt: new Date().toISOString(),
      });
      await this.write(updated);
      return this.materialize(updated);
    });
  }

  private async write(session: SessionMetadataRecord): Promise<void> {
    await writeJsonAtomic(this.pathFor(session.id), sessionMetadataSchema.parse(session));
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

function updateTaskRecord(task: SessionTask, input: UpdateTaskInput, now: string): SessionTask {
  const status = input.status ?? task.status;
  const patch: Partial<SessionTask> = {
    status,
    updatedAt: now,
    ...(input.turnId ? { updatedTurnId: input.turnId } : {}),
  };

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) {
      throw new Error("Task title must not be empty");
    }
    patch.title = title;
  }

  const description = trimOptional(input.description);
  const activeForm = trimOptional(input.activeForm);
  const blockedReason = trimOptional(input.blockedReason);
  const updated = applyTaskPatch(task, patch);

  if (input.description !== undefined) {
    if (description) {
      updated.description = description;
    } else {
      delete updated.description;
    }
  }

  if (input.activeForm !== undefined) {
    if (activeForm) {
      updated.activeForm = activeForm;
    } else {
      delete updated.activeForm;
    }
  }

  if (status === "blocked") {
    const reason = blockedReason ?? task.blockedReason;
    if (!reason) {
      throw new Error("Blocked tasks require a blockedReason");
    }
    updated.blockedReason = reason;
  } else {
    delete updated.blockedReason;
  }

  return updated;
}

function applyTaskPatch(task: SessionTask, patch: Partial<SessionTask>): SessionTask {
  return { ...task, ...patch };
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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
