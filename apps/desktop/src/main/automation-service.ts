import type {
  AutomationRunView,
  AutomationView,
  CreateAutomationInput,
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
} from "./automation-schedule";

export class AutomationService {
  private readonly repository: AutomationRepository;
  private readonly now: () => Date;

  constructor(options: {
    repository: AutomationRepository;
    now?: () => Date;
  }) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
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

  interpretSchedule(input: {
    scheduleText: string;
    timezone: string;
  }): ScheduleValidationResult {
    return interpretSchedule({
      scheduleText: input.scheduleText,
      timezone: input.timezone,
      now: this.now(),
    });
  }

  async create(input: CreateAutomationInput): Promise<AutomationView> {
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
      nextRunAt: status === "active" ? validation.nextRuns[0] : undefined,
    };
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
