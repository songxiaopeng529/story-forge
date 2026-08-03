import { describe, expect, it } from "vitest";
import {
  createCurrentTimeTool,
  createRuntimeEnvironment,
  formatRuntimeEnvironmentContext,
} from "../environment/runtime-environment";

describe("runtime environment", () => {
  const fixedNow = new Date("2026-08-03T06:07:08.000Z");

  it("formats date-level context in the user's timezone", () => {
    const environment = createRuntimeEnvironment(fixedNow, "Asia/Shanghai");

    expect(environment).toEqual({
      currentDate: "2026-08-03",
      timezone: "Asia/Shanghai",
    });
    expect(formatRuntimeEnvironmentContext(environment)).toBe([
      "<environment_context>",
      "  <current_date>2026-08-03</current_date>",
      "  <timezone>Asia/Shanghai</timezone>",
      "</environment_context>",
    ].join("\n"));
  });

  it("returns exact time only when the current_time tool is called", async () => {
    const tool = createCurrentTimeTool({
      now: () => fixedNow,
      getTimezone: () => "Asia/Shanghai",
    });

    expect(await tool.execute({}, {})).toEqual({
      currentDate: "2026-08-03",
      currentTime: "14:07:08",
      iso8601: "2026-08-03T14:07:08+08:00",
      timezone: "Asia/Shanghai",
      utcTime: "2026-08-03T06:07:08.000Z",
      utcOffset: "+08:00",
      unixTime: 1785737228,
    });
  });

  it("rejects invalid requested timezones", async () => {
    const tool = createCurrentTimeTool({ now: () => fixedNow });

    await expect(Promise.resolve().then(() => tool.execute({ timezone: "Mars/Olympus" }, {})))
      .rejects.toThrow("Invalid IANA timezone: Mars/Olympus");
  });
});
