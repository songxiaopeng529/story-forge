import { describe, expect, it, vi } from "vitest";
import { createAutomationProposalTool } from "./automation-proposal-tool";
import { ToolRegistry } from "./tool-registry";

describe("createAutomationProposalTool", () => {
  it("validates a proposal, emits it, and returns a confirmation-facing result", async () => {
    const emit = vi.fn();
    const validate = vi.fn((draft) => ({
      ...draft,
      summary: "Every day at 09:00",
      nextRuns: ["2026-06-20T01:00:00.000Z"],
    }));
    const registry = new ToolRegistry([
      createAutomationProposalTool({ validate, emit }),
    ]);

    await expect(registry.execute("automation.proposeCreate", {
      name: "Daily audit",
      scheduleText: "每天早上 9 点",
      cron: "0 9 * * *",
      timezone: "Asia/Shanghai",
      prompt: "Audit the repository.",
    })).resolves.toEqual({
      ok: true,
      output: {
        proposed: true,
        message: "Automation proposal is ready for user confirmation.",
      },
    });
    expect(validate).toHaveBeenCalledWith({
      name: "Daily audit",
      scheduleText: "每天早上 9 点",
      cron: "0 9 * * *",
      timezone: "Asia/Shanghai",
      prompt: "Audit the repository.",
    });
    expect(emit).toHaveBeenCalledWith({
      name: "Daily audit",
      scheduleText: "每天早上 9 点",
      cron: "0 9 * * *",
      timezone: "Asia/Shanghai",
      prompt: "Audit the repository.",
      summary: "Every day at 09:00",
      nextRuns: ["2026-06-20T01:00:00.000Z"],
    });
  });

  it("rejects empty proposal fields", async () => {
    const registry = new ToolRegistry([
      createAutomationProposalTool({
        validate: (draft) => ({ ...draft, summary: "Every hour", nextRuns: [] }),
        emit: () => undefined,
      }),
    ]);

    await expect(registry.execute("automation.proposeCreate", {
      name: " ",
      scheduleText: "hourly",
      cron: "0 * * * *",
      timezone: "UTC",
      prompt: "Check status.",
    })).resolves.toEqual({
      ok: false,
      error: "automation.proposeCreate requires a non-empty string name",
    });
  });
});
