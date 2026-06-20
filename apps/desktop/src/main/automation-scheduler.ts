import type {
  AutomationRunView,
  AutomationView,
  CreateAutomationInput,
  ScheduleValidationResult,
  SessionId,
  TurnId,
  UpdateAutomationInput,
} from "@story-forge/shared";
import { createAutomationRun } from "./automation-repository";
import type { AutomationService } from "./automation-service";

type AutomationCoordinator = {
  start(input: {
    sessionId: SessionId;
    prompt: string;
  }): Promise<{ turnId: TurnId }>;
  startAutomationRun(input: {
    workspaceId: string;
    providerId: AutomationView["providerId"];
    model: string;
    prompt: string;
    title?: string;
  }): Promise<{ sessionId: SessionId; turnId: TurnId }>;
  waitForTurn(turnId: TurnId): Promise<void>;
};

export class AutomationScheduler {
  private readonly service: AutomationService;
  private readonly coordinator: AutomationCoordinator;
  private readonly now: () => Date;
  private readonly onError: (error: unknown) => void;
  private readonly runningAutomationIds = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;

  constructor(options: {
    service: AutomationService;
    coordinator: AutomationCoordinator;
    now?: () => Date;
    onError?: (error: unknown) => void;
  }) {
    this.service = options.service;
    this.coordinator = options.coordinator;
    this.now = options.now ?? (() => new Date());
    this.onError = options.onError ?? (() => undefined);
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    void this.refresh();
  }

  stop(): void {
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  list(): Promise<AutomationView[]> {
    return this.service.list();
  }

  getRuns(automationId: string): Promise<AutomationRunView[]> {
    return this.service.getRuns(automationId);
  }

  validateSchedule(input: { cron: string; timezone: string }): ScheduleValidationResult {
    return this.service.validateSchedule(input);
  }

  interpretSchedule(input: {
    scheduleText: string;
    timezone: string;
  }): ScheduleValidationResult {
    return this.service.interpretSchedule(input);
  }

  async create(input: CreateAutomationInput): Promise<AutomationView> {
    const automation = await this.service.create(input);
    await this.refresh();
    return automation;
  }

  async update(input: UpdateAutomationInput): Promise<AutomationView> {
    const automation = await this.service.update(input);
    await this.refresh();
    return automation;
  }

  async delete(automationId: string): Promise<void> {
    await this.service.delete(automationId);
    await this.refresh();
  }

  async runNow(automationId: string): Promise<AutomationRunView> {
    const automation = await this.service.get(automationId);
    return this.runAutomation(automation, this.now().toISOString());
  }

  async runDue(now = this.now()): Promise<void> {
    const automations = await this.service.list();
    const due = automations.filter((automation) =>
      automation.status === "active"
      && automation.nextRunAt !== undefined
      && new Date(automation.nextRunAt).getTime() <= now.getTime()
    );
    await Promise.all(due.map((automation) =>
      this.runAutomation(automation, automation.nextRunAt ?? now.toISOString())
    ));
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.started) {
      return;
    }

    const next = (await this.service.list())
      .filter((automation) => automation.status === "active" && automation.nextRunAt)
      .sort((left, right) => String(left.nextRunAt).localeCompare(String(right.nextRunAt)))[0];
    if (!next?.nextRunAt) {
      return;
    }

    const delayMs = Math.max(0, new Date(next.nextRunAt).getTime() - this.now().getTime());
    this.timer = setTimeout(() => {
      void this.runDue().catch((error) => this.onError(error));
    }, Math.min(delayMs, 2_147_483_647));
    this.timer.unref?.();
  }

  private async runAutomation(
    automation: AutomationView,
    scheduledFor: string,
  ): Promise<AutomationRunView> {
    if (this.runningAutomationIds.has(automation.id)) {
      return this.service.appendRun({
        ...createAutomationRun({
          automationId: automation.id,
          scheduledFor,
          status: "skipped",
        }),
        ...(automation.kind === "thread_chat" && automation.sessionId
          ? { sessionId: automation.sessionId }
          : {}),
        error: "previous-run-still-active",
      });
    }

    this.runningAutomationIds.add(automation.id);
    let run = await this.service.appendRun({
      ...createAutomationRun({
        automationId: automation.id,
        scheduledFor,
        status: "running",
      }),
      ...(automation.kind === "thread_chat" && automation.sessionId
        ? { sessionId: automation.sessionId }
        : {}),
      startedAt: this.now().toISOString(),
    });

    try {
      const { sessionId, turnId } = await this.startAutomationTurn(automation);
      run = await this.service.updateRun({
        ...run,
        sessionId,
      });
      await this.coordinator.waitForTurn(turnId);
      return await this.service.updateRun({
        ...run,
        status: "completed",
        completedAt: this.now().toISOString(),
      });
    } catch (error) {
      const message = formatRunError(error);
      const status = message.startsWith("Session already has an active turn:")
        ? "skipped"
        : "failed";
      return await this.service.updateRun({
        ...run,
        status,
        completedAt: this.now().toISOString(),
        error: status === "skipped" ? "session-already-running" : message,
      });
    } finally {
      this.runningAutomationIds.delete(automation.id);
      try {
        await this.service.update({ automationId: automation.id });
      } catch (error) {
        this.onError(error);
      }
      await this.refresh();
    }
  }

  private async startAutomationTurn(
    automation: AutomationView,
  ): Promise<{ sessionId: SessionId; turnId: TurnId }> {
    if (automation.kind === "thread_chat") {
      if (!automation.sessionId) {
        throw new Error("session-not-found");
      }
      const { turnId } = await this.coordinator.start({
        sessionId: automation.sessionId,
        prompt: automation.prompt,
      });
      return {
        sessionId: automation.sessionId,
        turnId,
      };
    }

    return this.coordinator.startAutomationRun({
      workspaceId: automation.workspaceId,
      providerId: automation.providerId,
      model: automation.model,
      title: `Automation: ${automation.name}`,
      prompt: automation.prompt,
    });
  }
}

function formatRunError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
