// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AutomationRepository } from "../automation-repository";
import { AutomationScheduler } from "../automation-scheduler";
import { AutomationService } from "../automation-service";

describe("AutomationScheduler", () => {
  it("runs due automations in a fresh agent session and schedules the next run", async () => {
    const fixture = await createFixture();
    const automation = await fixture.service.create({
      name: "Hourly audit",
      status: "active",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      schedule: {
        sourceText: "hourly",
        cron: "0 * * * *",
        timezone: "UTC",
        summary: "",
      },
      prompt: "Audit the repo.",
    });
    fixture.now = new Date("2026-06-20T01:00:00.000Z");

    await fixture.scheduler.runDue();

    expect(fixture.startAutomationRun).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      title: "Automation: Hourly audit",
      prompt: "Audit the repo.",
    });
    await expect(fixture.service.getRuns(automation.id)).resolves.toEqual([
      expect.objectContaining({
        status: "completed",
        sessionId: "sf_session_automation",
        scheduledFor: "2026-06-20T01:00:00.000Z",
      }),
    ]);
    await expect(fixture.service.list()).resolves.toContainEqual(expect.objectContaining({
      id: automation.id,
      nextRunAt: "2026-06-20T02:00:00.000Z",
      lastRunStatus: "completed",
    }));
  });

  it("skips overlapping runs for the same automation", async () => {
    const fixture = await createFixture();
    const completion = createDeferred<void>();
    fixture.waitForTurn.mockImplementation(() => completion.promise.then(() => undefined));
    const automation = await fixture.service.create({
      name: "Hourly audit",
      status: "active",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      schedule: {
        sourceText: "hourly",
        cron: "0 * * * *",
        timezone: "UTC",
        summary: "",
      },
      prompt: "Audit the repo.",
    });
    fixture.now = new Date("2026-06-20T01:00:00.000Z");

    const firstRun = fixture.scheduler.runDue();
    await vi.waitFor(() => expect(fixture.startAutomationRun).toHaveBeenCalledTimes(1));
    await fixture.scheduler.runDue();
    completion.resolve();
    await firstRun;

    await expect(fixture.service.getRuns(automation.id)).resolves.toEqual([
      expect.objectContaining({ status: "completed" }),
      expect.objectContaining({
        status: "skipped",
        error: "previous-run-still-active",
      }),
    ]);
  });

  it("marks failed agent starts as failed runs", async () => {
    const fixture = await createFixture();
    fixture.startAutomationRun.mockRejectedValueOnce(new Error("provider unavailable"));
    const automation = await fixture.service.create({
      name: "Hourly audit",
      status: "active",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      schedule: {
        sourceText: "hourly",
        cron: "0 * * * *",
        timezone: "UTC",
        summary: "",
      },
      prompt: "Audit the repo.",
    });
    fixture.now = new Date("2026-06-20T01:00:00.000Z");

    await fixture.scheduler.runDue();

    await expect(fixture.service.getRuns(automation.id)).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        error: "provider unavailable",
      }),
    ]);
  });

  it("delegates runNow to the same runner path", async () => {
    const fixture = await createFixture();
    const automation = await fixture.service.create({
      name: "Manual audit",
      status: "paused",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      schedule: {
        sourceText: "daily",
        cron: "0 9 * * *",
        timezone: "UTC",
        summary: "",
      },
      prompt: "Audit the repo.",
    });

    await expect(fixture.scheduler.runNow(automation.id)).resolves.toMatchObject({
      automationId: automation.id,
      status: "completed",
    });
    expect(fixture.startAutomationRun).toHaveBeenCalledTimes(1);
  });

  it("runs thread timers in the existing session", async () => {
    const fixture = await createFixture();
    const automation = await fixture.service.create({
      name: "Thread timer",
      kind: "thread_chat",
      status: "active",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      sessionId: "sf_session_existing",
      schedule: {
        sourceText: "hourly",
        cron: "0 * * * *",
        timezone: "UTC",
        summary: "",
      },
      prompt: "Check this session.",
    });
    fixture.now = new Date("2026-06-20T01:00:00.000Z");

    await fixture.scheduler.runDue();

    expect(fixture.start).toHaveBeenCalledWith({
      sessionId: "sf_session_existing",
      prompt: "Check this session.",
    });
    await expect(fixture.service.getRuns(automation.id)).resolves.toEqual([
      expect.objectContaining({
        status: "completed",
        sessionId: "sf_session_existing",
      }),
    ]);
  });

  it("skips thread timers when the target session is already running", async () => {
    const fixture = await createFixture();
    fixture.start.mockRejectedValueOnce(
      new Error("Session already has an active turn: sf_session_existing"),
    );
    const automation = await fixture.service.create({
      name: "Thread timer",
      kind: "thread_chat",
      status: "active",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      sessionId: "sf_session_existing",
      schedule: {
        sourceText: "hourly",
        cron: "0 * * * *",
        timezone: "UTC",
        summary: "",
      },
      prompt: "Check this session.",
    });
    fixture.now = new Date("2026-06-20T01:00:00.000Z");

    await fixture.scheduler.runDue();

    await expect(fixture.service.getRuns(automation.id)).resolves.toEqual([
      expect.objectContaining({
        status: "skipped",
        error: "session-already-running",
      }),
    ]);
  });
});

async function createFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "story-forge-scheduler-"));
  const repository = new AutomationRepository({ rootDir });
  let now = new Date("2026-06-20T00:00:00.000Z");
  const service = new AutomationService({
    repository,
    now: () => now,
  });
  const startAutomationRun = vi.fn(async () => ({
    sessionId: "sf_session_automation" as const,
    turnId: "sf_turn_automation" as const,
  }));
  const start = vi.fn(async () => ({
    turnId: "sf_turn_existing" as const,
  }));
  const waitForTurn = vi.fn(async () => undefined);
  const scheduler = new AutomationScheduler({
    service,
    coordinator: {
      startAutomationRun,
      start,
      waitForTurn,
    },
    now: () => now,
  });

  return {
    service,
    scheduler,
    start,
    startAutomationRun,
    waitForTurn,
    get now() {
      return now;
    },
    set now(next: Date) {
      now = next;
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}
