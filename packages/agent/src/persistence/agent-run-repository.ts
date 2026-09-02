import type {
  AgentExecutionId,
  AgentExecutionStatus,
  AgentExecutionUsage,
  AgentExecutionView,
  AgentReport,
  AgentRole,
  AgentRunView,
  SessionId,
  TurnId,
} from "@story-forge/shared";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { isNodeError, readJsonOrQuarantine, writeJsonAtomic } from "./atomic-json";
import { resolveStoryForgePaths } from "./storyforge-home";

const sessionIdSchema = z.custom<SessionId>(
  (value) => typeof value === "string" && /^sf_session_[a-z0-9]+$/.test(value),
  { message: "Invalid session id" },
);

const turnIdSchema = z.custom<TurnId>(
  (value) => typeof value === "string" && /^sf_turn_[a-z0-9]+$/.test(value),
  { message: "Invalid turn id" },
);

const executionIdSchema = z.custom<AgentExecutionId>(
  (value) => typeof value === "string" && /^sf_agent_execution_[a-z0-9]+$/.test(value),
  { message: "Invalid agent execution id" },
);

const agentRoleSchema = z.enum(["root", "explorer", "reviewer"] satisfies AgentRole[]);
const executionStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
] satisfies AgentExecutionStatus[]);

const isoTimestampSchema = z.iso.datetime({ offset: true });

const agentExecutionUsageSchema: z.ZodType<AgentExecutionUsage> = z.object({
  turns: z.number().int().nonnegative().default(0),
  toolCalls: z.number().int().nonnegative().default(0),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().default(0),
});

const agentReportSchema = z.object({
  summary: z.string(),
  findings: z.array(z.string()),
  evidence: z.array(z.object({
    path: z.string().optional(),
    line: z.number().int().positive().optional(),
    detail: z.string(),
  })),
  filesInspected: z.array(z.string()),
  unresolved: z.array(z.string()),
});

export const agentExecutionRecordSchema = z.object({
  id: executionIdSchema,
  parentExecutionId: executionIdSchema.optional(),
  role: agentRoleSchema,
  objective: z.string(),
  status: executionStatusSchema,
  attempt: z.number().int().positive(),
  providerId: z.string().min(1),
  model: z.string().min(1),
  createdAt: isoTimestampSchema,
  startedAt: isoTimestampSchema.optional(),
  endedAt: isoTimestampSchema.optional(),
  usage: agentExecutionUsageSchema,
  report: agentReportSchema.optional(),
  error: z.string().optional(),
  truncated: z.boolean().optional(),
  transcriptFile: z.string().min(1).optional(),
});

export type AgentExecutionRecord = z.infer<typeof agentExecutionRecordSchema>;

export const agentRunRecordSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: sessionIdSchema,
  workspaceId: z.string().min(1),
  turnId: turnIdSchema,
  rootExecutionId: executionIdSchema,
  sequence: z.number().int().nonnegative(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  executions: z.array(agentExecutionRecordSchema).min(1),
});

export type AgentRunRecord = z.infer<typeof agentRunRecordSchema>;

export type CreateAgentRunInput = {
  sessionId: SessionId;
  workspaceId: string;
  turnId: TurnId;
  rootExecutionId: AgentExecutionId;
  executions: AgentExecutionRecord[];
  sequence?: number;
  createdAt?: string;
};

export class AgentRunRepository {
  private readonly runsDir: string;
  private readonly transcriptsDir: string;
  private readonly now: () => string;
  private readonly turnPaths = new Map<TurnId, string>();
  private readonly updateTails = new Map<TurnId, Promise<void>>();
  private initialization: Promise<void> | undefined;

  constructor(options: { rootDir: string; now?: () => string }) {
    const paths = resolveStoryForgePaths({ homeDir: options.rootDir });
    this.runsDir = paths.agentRunsDir;
    this.transcriptsDir = paths.agentTranscriptsDir;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async createRun(input: CreateAgentRunInput): Promise<AgentRunRecord> {
    await this.ensureInitialized();
    return this.enqueueUpdate(input.turnId, async () => {
      if (this.turnPaths.has(input.turnId)) {
        throw new Error(`Agent run already exists: ${input.turnId}`);
      }
      const timestamp = input.createdAt ?? this.now();
      const record = this.validateRun({
        schemaVersion: 1,
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        turnId: input.turnId,
        rootExecutionId: input.rootExecutionId,
        sequence: input.sequence ?? 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        executions: input.executions,
      });
      const filePath = this.pathFor(record.sessionId, record.turnId);
      await writeJsonAtomic(filePath, record);
      this.turnPaths.set(record.turnId, filePath);
      return record;
    });
  }

  async getRun(turnId: TurnId): Promise<AgentRunRecord | undefined> {
    assertTurnId(turnId);
    await this.ensureInitialized();
    return this.enqueueUpdate(turnId, async () => {
      const filePath = this.turnPaths.get(turnId);
      if (!filePath) {
        return undefined;
      }
      return this.readRun(filePath, turnId);
    });
  }

  async addExecutions(
    turnId: TurnId,
    executions: AgentExecutionRecord[],
  ): Promise<AgentRunRecord> {
    return this.updateRun(turnId, (record) => {
      const existingIds = new Set(record.executions.map((execution) => execution.id));
      const additions = executions.map((execution) => agentExecutionRecordSchema.parse(execution));
      for (const execution of additions) {
        if (existingIds.has(execution.id)) {
          throw new Error(`Agent execution already exists: ${execution.id}`);
        }
        existingIds.add(execution.id);
      }
      return { ...record, executions: [...record.executions, ...additions] };
    });
  }

  async setSequence(turnId: TurnId, sequence: number): Promise<AgentRunRecord> {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error(`Invalid agent run sequence: ${sequence}`);
    }
    return this.updateRun(turnId, (record) => {
      if (sequence < record.sequence) {
        throw new Error(
          `Agent run sequence cannot move backwards: ${sequence} < ${record.sequence}`,
        );
      }
      return { ...record, sequence };
    });
  }

  async updateExecution(
    turnId: TurnId,
    executionId: AgentExecutionId,
    updater: (execution: AgentExecutionRecord) => AgentExecutionRecord,
  ): Promise<AgentRunRecord> {
    assertExecutionId(executionId);
    return this.updateRun(turnId, (record) => {
      const index = record.executions.findIndex((execution) => execution.id === executionId);
      if (index < 0) {
        throw new Error(`Agent execution not found: ${executionId}`);
      }
      const current = record.executions[index]!;
      if (isTerminalStatus(current.status)) {
        throw new Error(`Terminal agent execution cannot be updated: ${executionId}`);
      }
      const updated = agentExecutionRecordSchema.parse(updater(structuredClone(current)));
      if (updated.id !== executionId) {
        throw new Error("Agent execution id cannot be changed");
      }
      const nextExecutions = [...record.executions];
      nextExecutions[index] = updated;
      return { ...record, executions: nextExecutions };
    });
  }

  async recoverInterruptedRuns(): Promise<void> {
    await this.ensureInitialized();
    const turnIds = [...this.turnPaths.keys()];
    await Promise.all(turnIds.map((turnId) => this.updateRun(turnId, (record) => {
      let changed = false;
      const endedAt = this.now();
      const executions = record.executions.map((execution) => {
        if (execution.status !== "queued" && execution.status !== "running") {
          return execution;
        }
        changed = true;
        return {
          ...execution,
          status: "interrupted" as const,
          endedAt,
        };
      });
      return changed ? { ...record, executions } : record;
    }, { writeUnchanged: false })));
  }

  async deleteSessionRuns(sessionId: SessionId): Promise<void> {
    assertSessionId(sessionId);
    await this.ensureInitialized();
    const turns = [...this.turnPaths.entries()]
      .filter(([, filePath]) => dirname(filePath) === this.sessionDirectory(sessionId))
      .map(([turnId]) => turnId);

    const records = await Promise.all(turns.map((turnId) =>
      this.enqueueUpdate(turnId, async () => {
        const filePath = this.turnPaths.get(turnId);
        return filePath ? this.readRun(filePath, turnId) : undefined;
      })
    ));
    const transcriptFiles = new Set(records.flatMap((record) =>
      record?.executions.flatMap((execution) =>
        execution.transcriptFile ? [execution.transcriptFile] : []
      ) ?? []
    ));
    for (const transcriptFile of transcriptFiles) {
      this.assertManagedTranscriptPath(transcriptFile);
    }
    for (const transcriptFile of transcriptFiles) {
      await rm(transcriptFile, { force: true });
    }
    const transcriptDirectories = new Set(records.flatMap((record) => record
      ? [this.executionTranscriptDirectory(record.workspaceId, record.turnId)]
      : []
    ));
    for (const transcriptDirectory of transcriptDirectories) {
      await rm(transcriptDirectory, { recursive: true, force: true });
    }
    await rm(this.sessionDirectory(sessionId), { recursive: true, force: true });
    for (const turnId of turns) {
      this.turnPaths.delete(turnId);
    }
  }

  toView(record: AgentRunRecord): AgentRunView {
    const validated = this.validateRun(record);
    return {
      schemaVersion: 1,
      sessionId: validated.sessionId,
      turnId: validated.turnId,
      rootExecutionId: validated.rootExecutionId,
      sequence: validated.sequence,
      createdAt: validated.createdAt,
      updatedAt: validated.updatedAt,
      executions: validated.executions.map(toExecutionView),
    };
  }

  private async updateRun(
    turnId: TurnId,
    updater: (record: AgentRunRecord) => AgentRunRecord,
    options: { writeUnchanged?: boolean } = {},
  ): Promise<AgentRunRecord> {
    assertTurnId(turnId);
    await this.ensureInitialized();
    return this.enqueueUpdate(turnId, async () => {
      const filePath = this.turnPaths.get(turnId);
      if (!filePath) {
        throw new Error(`Agent run not found: ${turnId}`);
      }
      const current = await this.readRun(filePath, turnId);
      const candidate = updater(structuredClone(current));
      if (options.writeUnchanged === false && JSON.stringify(candidate) === JSON.stringify(current)) {
        return current;
      }
      const updated = this.validateRun({ ...candidate, updatedAt: this.now() });
      if (updated.sessionId !== current.sessionId || updated.turnId !== current.turnId) {
        throw new Error("Agent run identity cannot be changed");
      }
      await writeJsonAtomic(filePath, updated);
      return updated;
    });
  }

  private async ensureInitialized(): Promise<void> {
    this.initialization ??= this.rebuildIndex().catch((error) => {
      this.initialization = undefined;
      throw error;
    });
    return this.initialization;
  }

  private async rebuildIndex(): Promise<void> {
    await mkdir(this.runsDir, { recursive: true });
    const nextIndex = new Map<TurnId, string>();
    const sessionEntries = await readdir(this.runsDir, { withFileTypes: true });
    for (const sessionEntry of sessionEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!sessionEntry.isDirectory() || !isValidSessionId(sessionEntry.name)) {
        continue;
      }
      const sessionDir = join(this.runsDir, sessionEntry.name);
      const files = await readdir(sessionDir, { withFileTypes: true });
      for (const file of files.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!file.isFile() || !/^sf_turn_[a-z0-9]+\.json$/.test(file.name)) {
          continue;
        }
        const filePath = join(sessionDir, file.name);
        let record: AgentRunRecord;
        try {
          record = await this.readRun(filePath);
          if (record.sessionId !== sessionEntry.name || `${record.turnId}.json` !== file.name) {
            await quarantine(filePath);
            continue;
          }
        } catch (error) {
          if (isCorruptRunError(error)) {
            continue;
          }
          throw error;
        }
        if (nextIndex.has(record.turnId)) {
          throw new Error(`Duplicate agent run turn id: ${record.turnId}`);
        }
        nextIndex.set(record.turnId, filePath);
      }
    }
    this.turnPaths.clear();
    for (const [turnId, filePath] of nextIndex) {
      this.turnPaths.set(turnId, filePath);
    }
  }

  private async readRun(filePath: string, expectedTurnId?: TurnId): Promise<AgentRunRecord> {
    const record = await readJsonOrQuarantine(
      filePath,
      agentRunRecordSchema,
      `Agent run snapshot is corrupt: ${expectedTurnId ?? filePath}`,
    );
    try {
      const validated = this.validateRun(record);
      if (expectedTurnId && validated.turnId !== expectedTurnId) {
        throw new Error(`Expected ${expectedTurnId}, found ${validated.turnId}`);
      }
      return validated;
    } catch (error) {
      await quarantine(filePath);
      throw new Error(`Agent run snapshot is corrupt: ${expectedTurnId ?? filePath}`, {
        cause: error,
      });
    }
  }

  private validateRun(input: unknown): AgentRunRecord {
    const record = agentRunRecordSchema.parse(input);
    const executionIds = new Set<AgentExecutionId>();
    for (const execution of record.executions) {
      if (executionIds.has(execution.id)) {
        throw new Error(`Duplicate agent execution id: ${execution.id}`);
      }
      executionIds.add(execution.id);
    }
    const root = record.executions.find((execution) => execution.id === record.rootExecutionId);
    if (!root || root.role !== "root" || root.parentExecutionId) {
      throw new Error("Agent run rootExecutionId must identify a root execution");
    }
    for (const execution of record.executions) {
      if (execution.transcriptFile) {
        this.assertExecutionTranscriptPath(record, execution.transcriptFile);
      }
    }
    return record;
  }

  private pathFor(sessionId: SessionId, turnId: TurnId): string {
    assertSessionId(sessionId);
    assertTurnId(turnId);
    return join(this.sessionDirectory(sessionId), `${turnId}.json`);
  }

  private sessionDirectory(sessionId: SessionId): string {
    assertSessionId(sessionId);
    return join(this.runsDir, sessionId);
  }

  private assertManagedTranscriptPath(filePath: string): void {
    const managedRoot = resolve(this.transcriptsDir);
    const resolvedPath = resolve(filePath);
    const relativePath = relative(managedRoot, resolvedPath);
    if (!relativePath || relativePath.startsWith("..") || resolve(managedRoot, relativePath) !== resolvedPath) {
      throw new Error(`Agent transcript is outside the managed directory: ${filePath}`);
    }
  }

  private assertExecutionTranscriptPath(
    record: Pick<AgentRunRecord, "workspaceId" | "turnId">,
    filePath: string,
  ): void {
    this.assertManagedTranscriptPath(filePath);
    const expectedDirectory = this.executionTranscriptDirectory(
      record.workspaceId,
      record.turnId,
    );
    const resolvedPath = resolve(filePath);
    const relativePath = relative(expectedDirectory, resolvedPath);
    if (
      !relativePath
      || relativePath.startsWith("..")
      || resolve(expectedDirectory, relativePath) !== resolvedPath
    ) {
      throw new Error(`Agent transcript does not belong to this run: ${filePath}`);
    }
  }

  private executionTranscriptDirectory(workspaceId: string, turnId: TurnId): string {
    return resolve(
      this.transcriptsDir,
      sanitizePathPart(workspaceId),
      sanitizePathPart(turnId),
    );
  }

  private enqueueUpdate<T>(turnId: TurnId, operation: () => Promise<T>): Promise<T> {
    const previous = this.updateTails.get(turnId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.updateTails.set(turnId, tail);
    void tail.finally(() => {
      if (this.updateTails.get(turnId) === tail) {
        this.updateTails.delete(turnId);
      }
    });
    return result;
  }
}

function toExecutionView(record: AgentExecutionRecord): AgentExecutionView {
  return {
    id: record.id,
    ...(record.parentExecutionId ? { parentExecutionId: record.parentExecutionId } : {}),
    role: record.role,
    objective: record.objective,
    status: record.status,
    attempt: record.attempt,
    providerId: record.providerId,
    model: record.model,
    createdAt: record.createdAt,
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    ...(record.endedAt ? { endedAt: record.endedAt } : {}),
    usage: record.usage,
    ...(record.report ? { report: toReport(record.report) } : {}),
    ...(record.error ? { error: record.error } : {}),
    ...(record.truncated === undefined ? {} : { truncated: record.truncated }),
  };
}

function toReport(record: z.infer<typeof agentReportSchema>): AgentReport {
  return {
    summary: record.summary,
    findings: record.findings,
    evidence: record.evidence.map((entry) => ({
      ...(entry.path === undefined ? {} : { path: entry.path }),
      ...(entry.line === undefined ? {} : { line: entry.line }),
      detail: entry.detail,
    })),
    filesInspected: record.filesInspected,
    unresolved: record.unresolved,
  };
}

function isTerminalStatus(status: AgentExecutionStatus): boolean {
  return status === "completed"
    || status === "failed"
    || status === "cancelled"
    || status === "interrupted";
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_") || "default";
}

function assertSessionId(value: unknown): asserts value is SessionId {
  if (!isValidSessionId(value)) {
    throw new Error(`Invalid session id: ${String(value)}`);
  }
}

function isValidSessionId(value: unknown): value is SessionId {
  return typeof value === "string" && /^sf_session_[a-z0-9]+$/.test(value);
}

function assertTurnId(value: unknown): asserts value is TurnId {
  if (typeof value !== "string" || !/^sf_turn_[a-z0-9]+$/.test(value)) {
    throw new Error(`Invalid turn id: ${String(value)}`);
  }
}

function assertExecutionId(value: unknown): asserts value is AgentExecutionId {
  if (typeof value !== "string" || !/^sf_agent_execution_[a-z0-9]+$/.test(value)) {
    throw new Error(`Invalid agent execution id: ${String(value)}`);
  }
}

function isCorruptRunError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Agent run snapshot is corrupt:");
}

async function quarantine(filePath: string): Promise<void> {
  try {
    await rename(filePath, `${filePath}.corrupt-${Date.now()}`);
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) {
      throw error;
    }
  }
}
