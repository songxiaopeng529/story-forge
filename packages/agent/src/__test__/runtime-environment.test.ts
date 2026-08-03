import { describe, expect, it } from "vitest";
import { createRuntimeEnvironmentExtension } from "../runtime-environment";

describe("createRuntimeEnvironmentExtension", () => {
  it("appends fresh environment context without mutating or persisting source messages", async () => {
    let contextHandler: ((event: { messages: unknown[] }) => unknown) | undefined;
    const runtimeEnvironment = createRuntimeEnvironmentExtension({
      now: () => new Date("2026-08-03T23:30:00.000Z"),
      getTimezone: () => "Asia/Shanghai",
    });
    await runtimeEnvironment.extension.factory({
      on(event: string, handler: (event: { messages: unknown[] }) => unknown) {
        if (event === "context") {
          contextHandler = handler;
        }
      },
    } as never);
    const messages = [{ role: "user", content: "What is new today?", timestamp: 1 }];

    const result = contextHandler?.({ messages }) as { messages: Array<Record<string, unknown>> };

    expect(messages).toHaveLength(1);
    expect(result.messages).toHaveLength(2);
    expect(result.messages.at(-1)).toMatchObject({
      role: "custom",
      customType: "storyforge-runtime-environment",
      display: false,
      content: expect.stringContaining("<current_date>2026-08-04</current_date>"),
      details: {
        currentDate: "2026-08-04",
        timezone: "Asia/Shanghai",
      },
    });
    expect(runtimeEnvironment.getLatest()).toEqual({
      currentDate: "2026-08-04",
      timezone: "Asia/Shanghai",
    });
  });
});
