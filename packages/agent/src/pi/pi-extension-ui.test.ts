import type { AgentEvent } from "@story-forge/shared";
import { describe, expect, it } from "vitest";
import { PiExtensionUiBridge } from "./pi-extension-ui";

describe("PiExtensionUiBridge", () => {
  it("round-trips PI selection requests through StoryForge events", async () => {
    const events: AgentEvent[] = [];
    const bridge = new PiExtensionUiBridge((event) => events.push(event));
    const context = bridge.createContext({
      sessionId: "sf_session_plan",
      turnId: "sf_turn_plan",
      signal: new AbortController().signal,
    });

    const selection = context.select("Choose action", ["Continue", "Start fresh"]);
    const request = events.at(-1);

    expect(request).toMatchObject({
      type: "extension.ui.request",
      method: "select",
      title: "Choose action",
      options: ["Continue", "Start fresh"],
    });
    if (!request || request.type !== "extension.ui.request") {
      throw new Error("Expected extension UI request");
    }

    bridge.respond({ requestId: request.requestId, value: "Start fresh" });
    await expect(selection).resolves.toBe("Start fresh");
  });

  it("cancels pending PI dialogs when a turn is aborted", async () => {
    const events: AgentEvent[] = [];
    const controller = new AbortController();
    const bridge = new PiExtensionUiBridge((event) => events.push(event));
    const context = bridge.createContext({
      sessionId: "sf_session_plan",
      turnId: "sf_turn_plan",
      signal: controller.signal,
    });

    const confirmation = context.confirm("Continue?", "Proceed with this action?");
    controller.abort();

    await expect(confirmation).resolves.toBe(false);
  });

  it("maps PI status and notification updates to StoryForge events", () => {
    const events: AgentEvent[] = [];
    const bridge = new PiExtensionUiBridge((event) => events.push(event));
    const context = bridge.createContext({
      sessionId: "sf_session_plan",
      turnId: "sf_turn_plan",
      signal: new AbortController().signal,
    });

    context.setStatus("todo", "2/4 completed");
    context.notify("Todo updated", "info");

    expect(events).toEqual([
      expect.objectContaining({
        type: "extension.status",
        key: "todo",
        text: "2/4 completed",
      }),
      expect.objectContaining({
        type: "extension.notification",
        message: "Todo updated",
        level: "info",
      }),
    ]);
  });
});
