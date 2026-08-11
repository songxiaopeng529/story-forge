// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createScheduleCronGenerator,
  extractCronExpression,
} from "../automation-schedule-generator";

describe("automation schedule generator", () => {
  it("extracts cron expressions from model output", () => {
    expect(extractCronExpression('{"cron":"0 9 * * *"}')).toBe("0 9 * * *");
    expect(extractCronExpression("```json\n{\"cron\":\"*/15 * * * *\"}\n```"))
      .toBe("*/15 * * * *");
    expect(extractCronExpression("cron: 30 8 * * 1")).toBe("30 8 * * 1");
  });

  it("rejects six-field cron output instead of truncating it", () => {
    expect(extractCronExpression('{"cron":"0 0 9 * * *"}')).toBeUndefined();
    expect(extractCronExpression("cron: 0 0 9 * * *")).toBeUndefined();
  });

  it("uses a direct model completion to generate cron text", async () => {
    const completeText = vi.fn(async () => '{"cron":"45 7 * * *"}');
    const generateCron = createScheduleCronGenerator({ completeText });

    await expect(generateCron({
      scheduleText: "每天早上七点四十五",
      timezone: "Asia/Shanghai",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      now: new Date("2026-06-20T00:00:00.000Z"),
    })).resolves.toBe("45 7 * * *");
    expect(completeText).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      maxTokens: 64,
    }));
  });
});
