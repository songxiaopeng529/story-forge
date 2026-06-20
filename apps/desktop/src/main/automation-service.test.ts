// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AutomationRepository } from "./automation-repository";
import { AutomationService } from "./automation-service";

describe("AutomationService", () => {
  it("validates cron schedules with timezone preview", async () => {
    const service = await createService();

    expect(service.validateSchedule({
      cron: "0 9 * * *",
      timezone: "Asia/Shanghai",
    })).toEqual({
      ok: true,
      cron: "0 9 * * *",
      timezone: "Asia/Shanghai",
      summary: "Every day at 09:00",
      nextRuns: [
        "2026-06-20T01:00:00.000Z",
        "2026-06-21T01:00:00.000Z",
        "2026-06-22T01:00:00.000Z",
      ],
    });
    expect(service.validateSchedule({
      cron: "0 9 * *",
      timezone: "Asia/Shanghai",
    })).toEqual({
      ok: false,
      error: "Cron expression must use five fields.",
    });
  });

  it("interprets common natural language schedules", async () => {
    const service = await createService();

    expect(service.interpretSchedule({
      scheduleText: "每天上午 9 点",
      timezone: "Asia/Shanghai",
    })).toMatchObject({
      ok: true,
      cron: "0 9 * * *",
      timezone: "Asia/Shanghai",
    });
    expect(service.interpretSchedule({
      scheduleText: "whenever the moon is bright",
      timezone: "Asia/Shanghai",
    })).toMatchObject({
      ok: false,
    });
  });

  it("interprets minute interval schedules from the current time", async () => {
    const service = await createService();

    expect(service.interpretSchedule({
      scheduleText: "从今天现在此时此刻开始，每隔1分钟执行一次",
      timezone: "Asia/Shanghai",
    })).toEqual({
      ok: true,
      cron: "* * * * *",
      timezone: "Asia/Shanghai",
      summary: "Every minute (从今天现在此时此刻开始，每隔1分钟执行一次)",
      nextRuns: [
        "2026-06-20T00:01:00.000Z",
        "2026-06-20T00:02:00.000Z",
        "2026-06-20T00:03:00.000Z",
      ],
    });

    expect(service.interpretSchedule({
      scheduleText: "every 5 minutes",
      timezone: "UTC",
    })).toMatchObject({
      ok: true,
      cron: "*/5 * * * *",
      summary: "Every 5 minutes (every 5 minutes)",
    });
  });

  it("creates, updates, pauses, deletes, and lists automations", async () => {
    const service = await createService();
    const created = await service.create({
      name: "Daily check",
      status: "active",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      schedule: {
        sourceText: "daily at 9",
        cron: "0 9 * * *",
        timezone: "Asia/Shanghai",
        summary: "",
      },
      prompt: "Check dependency risk.",
    });

    expect(created).toMatchObject({
      kind: "scheduled_chat",
      status: "active",
      nextRunAt: "2026-06-20T01:00:00.000Z",
      schedule: { summary: "Every day at 09:00" },
    });

    await expect(service.update({
      automationId: created.id,
      status: "paused",
    })).resolves.toMatchObject({
      id: created.id,
      status: "paused",
      nextRunAt: undefined,
    });
    await service.delete(created.id);
    await expect(service.list()).resolves.toEqual([]);
  });

  it("creates a thread timer bound to an existing session id", async () => {
    const service = await createService();

    await expect(service.create({
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
    })).resolves.toMatchObject({
      kind: "thread_chat",
      sessionId: "sf_session_existing",
      nextRunAt: "2026-06-20T01:00:00.000Z",
    });
  });

  it("rejects thread timers without a session id", async () => {
    const service = await createService();

    await expect(service.create({
      name: "Broken thread timer",
      kind: "thread_chat",
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
      prompt: "Check this session.",
    })).rejects.toThrow("Thread timers require a session id.");
  });

  it("caps run history at the latest 50 records", async () => {
    const service = await createService();
    const automation = await service.create({
      name: "Hourly check",
      status: "active",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      schedule: {
        sourceText: "hourly",
        cron: "0 * * * *",
        timezone: "UTC",
        summary: "Every hour",
      },
      prompt: "Check status.",
    });

    for (let index = 0; index < 60; index += 1) {
      await service.createScheduledRun(
        automation.id,
        new Date(Date.UTC(2026, 5, 20, index % 24, 0, index)).toISOString(),
      );
    }

    await expect(service.getRuns(automation.id)).resolves.toHaveLength(50);
  });
});

async function createService(): Promise<AutomationService> {
  const rootDir = await mkdtemp(join(tmpdir(), "story-forge-automations-"));
  return new AutomationService({
    repository: new AutomationRepository({ rootDir }),
    now: () => new Date("2026-06-20T00:00:00.000Z"),
  });
}
