import type { AgentEvent } from "@story-forge/shared";
import { describe, expect, it } from "vitest";
import { PiExtensionUiBridge } from "../pi-extension-ui";

describe("PiExtensionUiBridge", () => {
  it("round-trips PI selection requests through StoryForge events", async () => {
    const events: AgentEvent[] = [];
    const bridge = new PiExtensionUiBridge((event) => events.push(event));
    const context = bridge.createContext({
      sessionId: "sf_session_plan",
      turnId: "sf_turn_plan",
      signal: new AbortController().signal,
    });

    const selection = context.select("Plan ready", [
      "Start implementing",
      "Start fresh and implement",
      "Continue planning",
    ]);
    const request = events.at(-1);

    expect(request).toMatchObject({
      type: "extension.ui.request",
      method: "select",
      title: "Plan ready",
      options: ["Start implementing", "Continue planning"],
    });
    if (!request || request.type !== "extension.ui.request") {
      throw new Error("Expected extension UI request");
    }

    bridge.respond({ requestId: request.requestId, value: "Start implementing" });
    await expect(selection).resolves.toBe("Start implementing");
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

    const confirmation = context.confirm("Leave plan mode?", "Discard the plan?");
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

    context.setStatus("plan-mode", "Planning");
    context.notify("Plan mode enabled", "info");

    expect(events).toEqual([
      expect.objectContaining({
        type: "extension.status",
        key: "plan-mode",
        text: "Planning",
      }),
      expect.objectContaining({
        type: "extension.notification",
        message: "Plan mode enabled",
        level: "info",
      }),
    ]);
  });
});
