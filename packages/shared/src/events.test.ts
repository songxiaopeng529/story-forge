import { describe, expect, it } from "vitest";

import { createSessionId, isTerminalAgentEvent } from "./events";

describe("createSessionId", () => {
  it("returns a StoryForge session id", () => {
    expect(createSessionId()).toMatch(/^sf_session_[a-z0-9]+$/);
  });
});

describe("isTerminalAgentEvent", () => {
  it("returns true for terminal runtime events", () => {
    expect(isTerminalAgentEvent({ type: "runtime.completed" })).toBe(true);
    expect(
      isTerminalAgentEvent({
        type: "runtime.error",
        error: { message: "The runtime stopped." },
      }),
    ).toBe(true);
  });

  it("returns false for non-terminal agent events", () => {
    expect(
      isTerminalAgentEvent({
        type: "message.delta",
        delta: "hello",
      }),
    ).toBe(false);
  });
});
