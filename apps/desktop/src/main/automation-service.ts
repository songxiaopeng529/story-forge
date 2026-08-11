import type {
  AutomationKind,
  AutomationRunView,
  AutomationView,
  CreateAutomationInput,
  ProviderId,
  ScheduleValidationResult,
  UpdateAutomationInput,
} from "@story-forge/shared";
import {
  AutomationRepository,
  createAutomationRun,
} from "./automation-repository";
import {
  interpretSchedule,
  validateSchedule,
} from "@story-forge/extensions";
import type { ScheduleCronGenerator } from "./automation-schedule-generator";

export class AutomationService {
  private readonly repository: AutomationRepository;
  private readonly now: () => Date;
  private readonly generateCron: ScheduleCronGenerator | undefined;

  constructor(options: {
    repository: AutomationRepository;
    now?: () => Date;
    generateCron?: ScheduleCronGenerator;
  }) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.generateCron = options.generateCron;
  }

  list(): Promise<AutomationView[]> {
    return this.repository.list();
  }

  get(automationId: string): Promise<AutomationView> {
    return this.repository.get(automationId);
  }

  getRuns(automationId: string): Promise<AutomationRunView[]> {
    return this.repository.listRuns(automationId);
  }

  validateSchedule(input: { cron: string; timezone: string }): ScheduleValidationResult {
    return validateSchedule({
      cron: input.cron,
      timezone: input.timezone,
      now: this.now(),
    });
  }

  async interpretSchedule(input: {
    scheduleText: string;
    timezone: string;
    providerId: ProviderId;
    model: string;
  }): Promise<ScheduleValidationResult> {
    const now = this.now();
    if (!this.generateCron) {
      return interpretSchedule({
        scheduleText: input.scheduleText,
        timezone: input.timezone,
        now,
      });
    }

    const cron = await this.generateCron({
      scheduleText: input.scheduleText,
      timezone: input.timezone,
      providerId: input.providerId,
      model: input.model,
      now,
    });
    const validation = validateSchedule({
      cron,
      timezone: input.timezone,
      now,
    });
    if (!validation.ok) {
      return {
        ok: false,
        error: `Generated cron expression is invalid: ${validation.error}`,
      };
    }
    return {
      ...validation,
      summary: `${validation.summary} (${input.scheduleText.trim()})`,
    };
  }

  async create(input: CreateAutomationInput): Promise<AutomationView> {
    const kind = normalizeAutomationKind(input.kind);
    ensureThreadTimerHasSession(kind, input.sessionId);
    const validation = this.validateSchedule({
      cron: input.schedule.cron,
      timezone: input.schedule.timezone,
    });
    if (!validation.ok) {
      throw new Error(validation.error);
    }
    const nextRunAt = input.status === "active" ? validation.nextRuns[0] : undefined;
    return this.repository.create({
      ...input,
      kind,
      schedule: {
        ...input.schedule,
        cron: validation.cron,
        timezone: validation.timezone,
        summary: input.schedule.summary || validation.summary,
      },
      ...(nextRunAt ? { nextRunAt } : {}),
    });
  }

  async update(input: UpdateAutomationInput): Promise<AutomationView> {
    const current = await this.repository.get(input.automationId);
    const kind = normalizeAutomationKind(input.kind ?? current.kind);
    const sessionId = input.sessionId ?? current.sessionId;
    ensureThreadTimerHasSession(kind, sessionId);
    const schedule = input.schedule ?? current.schedule;
    const status = input.status ?? current.status;
    const validation = this.validateSchedule({
      cron: schedule.cron,
      timezone: schedule.timezone,
    });
    if (!validation.ok) {
      throw new Error(validation.error);
    }
    const updateInput: UpdateAutomationInput & { nextRunAt?: string | undefined } = {
      ...input,
      kind,
      nextRunAt: status === "active" ? validation.nextRuns[0] : undefined,
    };
    if (sessionId) {
      updateInput.sessionId = sessionId;
    }
    if (input.schedule) {
      updateInput.schedule = {
        ...input.schedule,
        cron: validation.cron,
        timezone: validation.timezone,
        summary: input.schedule.summary || validation.summary,
      };
    }
    return this.repository.update(updateInput);
  }

  delete(automationId: string): Promise<void> {
    return this.repository.delete(automationId);
  }

  async appendRun(run: AutomationRunView): Promise<AutomationRunView> {
    return this.repository.appendRun(run);
  }

  async updateRun(run: AutomationRunView): Promise<AutomationRunView> {
    return this.repository.updateRun(run);
  }

  async createScheduledRun(automationId: string, scheduledFor: string): Promise<AutomationRunView> {
    return this.repository.appendRun(createAutomationRun({
      automationId,
      scheduledFor,
      status: "scheduled",
    }));
  }

  async runNow(automationId: string): Promise<AutomationRunView> {
    await this.repository.get(automationId);
    return this.createScheduledRun(automationId, this.now().toISOString());
  }

  recoverRunningRuns(): Promise<void> {
    return this.repository.recoverRunningRuns();
  }
}

function normalizeAutomationKind(kind: AutomationKind | undefined): AutomationKind {
  return kind ?? "scheduled_chat";
}

function ensureThreadTimerHasSession(
  kind: AutomationKind,
  sessionId: AutomationView["sessionId"],
): void {
  if (kind === "thread_chat" && !sessionId) {
    throw new Error("Thread timers require a session id.");
  }
}
