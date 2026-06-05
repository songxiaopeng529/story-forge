import { describe, expect, it } from "vitest";
import { createDesktopRuntime } from "./runtime-factory";

describe("createDesktopRuntime", () => {
  it("creates a runtime with workspace file tools", async () => {
    const runtime = createDesktopRuntime({
      workspaceRoot: "/tmp/story-forge",
      providerConfig: {
        apiKey: "key",
        baseUrl: "https://models.example.com/v1",
        model: "story-model",
      },
      fetch: async () =>
        new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ready" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    const events = [];
    for await (const event of runtime.runTurn("Say ready")) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "runtime.started",
      "message.delta",
      "runtime.completed",
    ]);
  });
});
