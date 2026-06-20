import type {
  AutomationRunView,
  AutomationView,
  CreateAutomationInput,
  UpdateAutomationInput,
} from "@story-forge/shared";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "./atomic-json";

const providerIdSchema = z.enum(["deepseek", "openai", "anthropic", "openrouter", "volcano"]);
const automationStatusSchema = z.enum(["active", "paused"]);
const automationRunStatusSchema = z.enum(["scheduled", "running", "completed", "failed", "skipped"]);
const automationScheduleSchema = z.object({
  sourceText: z.string(),
  cron: z.string().min(1),
  timezone: z.string().min(1),
  summary: z.string().min(1),
});
const automationSchema: z.ZodType<AutomationView> = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  kind: z.literal("scheduled_chat"),
  name: z.string().min(1),
  status: automationStatusSchema,
  workspaceId: z.string().min(1),
  providerId: providerIdSchema,
  model: z.string().min(1),
  schedule: automationScheduleSchema,
  prompt: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().optional(),
  nextRunAt: z.string().optional(),
  lastRunStatus: automationRunStatusSchema.optional(),
});
const automationFileSchema = z.object({
  schemaVersion: z.literal(1),
  automations: z.array(automationSchema),
});
const automationRunSchema: z.ZodType<AutomationRunView> = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  automationId: z.string().min(1),
  sessionId: z.custom<`sf_session_${string}`>(
    (value) => typeof value === "string" && /^sf_session_[a-z0-9]+$/.test(value),
    { message: "Invalid session id" },
  ).optional(),
  status: automationRunStatusSchema,
  scheduledFor: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
});
const automationRunsFileSchema = z.object({
  schemaVersion: z.literal(1),
  runs: z.array(automationRunSchema),
});

const MAX_RUNS_PER_AUTOMATION = 50;

export class AutomationRepository {
  private readonly automationsPath: string;
  private readonly runsDir: string;

  constructor(options: { rootDir: string }) {
    const automationsDir = join(options.rootDir, "automations");
    this.automationsPath = join(automationsDir, "automations.json");
    this.runsDir = join(automationsDir, "runs");
  }

  async list(): Promise<AutomationView[]> {
    const file = await this.readAutomations();
    return file.automations.sort((left, right) => {
      const leftKey = left.nextRunAt ?? left.updatedAt;
      const rightKey = right.nextRunAt ?? right.updatedAt;
      return leftKey.localeCompare(rightKey);
    });
  }

  async get(automationId: string): Promise<AutomationView> {
    const automation = (await this.readAutomations()).automations.find(
      (candidate) => candidate.id === automationId,
    );
    if (!automation) {
      throw new Error(`Automation not found: ${automationId}`);
    }
    return automation;
  }

  async create(input: CreateAutomationInput & { nextRunAt?: string }): Promise<AutomationView> {
    const now = new Date().toISOString();
    const automation: AutomationView = {
      schemaVersion: 1,
      id: createAutomationId(),
      kind: "scheduled_chat",
      name: input.name.trim(),
      status: input.status,
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      model: input.model.trim(),
      schedule: input.schedule,
      prompt: input.prompt.trim(),
      createdAt: now,
      updatedAt: now,
      ...(input.nextRunAt ? { nextRunAt: input.nextRunAt } : {}),
    };
    const file = await this.readAutomations();
    await this.writeAutomations({
      schemaVersion: 1,
      automations: [...file.automations, automationSchema.parse(automation)],
    });
    return automation;
  }

  async update(
    input: UpdateAutomationInput & { nextRunAt?: string | undefined },
  ): Promise<AutomationView> {
    const file = await this.readAutomations();
    const current = file.automations.find((automation) => automation.id === input.automationId);
    if (!current) {
      throw new Error(`Automation not found: ${input.automationId}`);
    }
    const updated = automationSchema.parse({
      ...current,
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
      ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
      ...(input.model === undefined ? {} : { model: input.model.trim() }),
      ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
      ...(input.prompt === undefined ? {} : { prompt: input.prompt.trim() }),
      updatedAt: new Date().toISOString(),
      nextRunAt: input.nextRunAt,
    });
    await this.writeAutomations({
      schemaVersion: 1,
      automations: file.automations.map((automation) =>
        automation.id === input.automationId ? updated : automation
      ),
    });
    return updated;
  }

  async delete(automationId: string): Promise<void> {
    const file = await this.readAutomations();
    await this.writeAutomations({
      schemaVersion: 1,
      automations: file.automations.filter((automation) => automation.id !== automationId),
    });
    await rm(this.runsPathFor(automationId), { force: true });
  }

  async listRuns(automationId: string): Promise<AutomationRunView[]> {
    const file = await this.readRuns(automationId);
    return file.runs.sort((left, right) => right.scheduledFor.localeCompare(left.scheduledFor));
  }

  async appendRun(run: AutomationRunView): Promise<AutomationRunView> {
    const parsed = automationRunSchema.parse(run);
    const file = await this.readRuns(parsed.automationId);
    const runs = [parsed, ...file.runs.filter((candidate) => candidate.id !== parsed.id)]
      .slice(0, MAX_RUNS_PER_AUTOMATION);
    await this.writeRuns(parsed.automationId, { schemaVersion: 1, runs });
    await this.patchAutomationRunState(parsed.automationId, parsed);
    return parsed;
  }

  async updateRun(run: AutomationRunView): Promise<AutomationRunView> {
    const parsed = automationRunSchema.parse(run);
    const file = await this.readRuns(parsed.automationId);
    const runs = [parsed, ...file.runs.filter((candidate) => candidate.id !== parsed.id)]
      .slice(0, MAX_RUNS_PER_AUTOMATION);
    await this.writeRuns(parsed.automationId, { schemaVersion: 1, runs });
    await this.patchAutomationRunState(parsed.automationId, parsed);
    return parsed;
  }

  async recoverRunningRuns(): Promise<void> {
    for (const automation of await this.list()) {
      const runs = await this.listRuns(automation.id);
      await Promise.all(
        runs
          .filter((run) => run.status === "running")
          .map((run) =>
            this.updateRun({
              ...run,
              status: "failed",
              completedAt: new Date().toISOString(),
              error: "application-restarted",
            })
          ),
      );
    }
  }

  private async patchAutomationRunState(
    automationId: string,
    run: AutomationRunView,
  ): Promise<void> {
    const file = await this.readAutomations();
    const automation = file.automations.find((candidate) => candidate.id === automationId);
    if (!automation) {
      return;
    }
    const updated = automationSchema.parse({
      ...automation,
      lastRunAt: run.startedAt ?? run.scheduledFor,
      lastRunStatus: run.status,
      updatedAt: new Date().toISOString(),
    });
    await this.writeAutomations({
      schemaVersion: 1,
      automations: file.automations.map((candidate) =>
        candidate.id === automationId ? updated : candidate
      ),
    });
  }

  private async readAutomations() {
    return readJson(this.automationsPath, automationFileSchema, {
      schemaVersion: 1 as const,
      automations: [],
    });
  }

  private async writeAutomations(file: z.infer<typeof automationFileSchema>): Promise<void> {
    await writeJsonAtomic(this.automationsPath, automationFileSchema.parse(file));
  }

  private async readRuns(automationId: string) {
    return readJson(this.runsPathFor(automationId), automationRunsFileSchema, {
      schemaVersion: 1 as const,
      runs: [],
    });
  }

  private async writeRuns(
    automationId: string,
    file: z.infer<typeof automationRunsFileSchema>,
  ): Promise<void> {
    await mkdir(this.runsDir, { recursive: true });
    await writeJsonAtomic(this.runsPathFor(automationId), automationRunsFileSchema.parse(file));
  }

  private runsPathFor(automationId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(automationId)) {
      throw new Error(`Invalid automation id: ${automationId}`);
    }
    return join(this.runsDir, `${automationId}.json`);
  }
}

export function createAutomationRun(input: {
  automationId: string;
  scheduledFor: string;
  status?: AutomationRunView["status"];
}): AutomationRunView {
  return {
    schemaVersion: 1,
    id: createAutomationRunId(),
    automationId: input.automationId,
    status: input.status ?? "scheduled",
    scheduledFor: input.scheduledFor,
  };
}

function createAutomationId(): string {
  return `sf_automation_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function createAutomationRunId(): string {
  return `sf_automation_run_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
