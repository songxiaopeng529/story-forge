import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ModelRequestEvent } from "@story-forge/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelRequestDrawer } from "../model-request-drawer";

afterEach(() => {
  cleanup();
});

describe("ModelRequestDrawer", () => {
  it("shows selected XML message content as a formatted wrapping preview", () => {
    render(
      <ModelRequestDrawer
        onClose={() => undefined}
        requests={[createRequest({
          messages: [
            {
              role: "system",
              content:
                "<storyforge-context version=\"1\"><main>You are StoryForge.</main><skills count=\"0\"></skills></storyforge-context>",
            },
            { role: "user", content: "你好" },
          ],
        })]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Runtime instructions/ }));

    expect(screen.getByRole("button", { name: "Content Preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("<storyforge-context version=\"1\">")).toBeInTheDocument();
    expect(screen.getByText("<main>")).toBeInTheDocument();
    expect(screen.getByText("You are StoryForge.")).toBeInTheDocument();
    expect(screen.getByText("</storyforge-context>")).toBeInTheDocument();

    const preview = screen.getByTestId("model-message-content-preview");
    expect(preview).toHaveClass("whitespace-pre-wrap", "break-words");
    expect(preview).not.toHaveTextContent("\"content\"");
  });

  it("copies raw JSON for the selected message while content preview is visible", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const message = {
      role: "system" as const,
      content: "<storyforge-context version=\"1\"><main>Rules</main></storyforge-context>",
    };
    render(
      <ModelRequestDrawer
        onClose={() => undefined}
        requests={[createRequest({ messages: [message] })]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Runtime instructions/ }));
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(message, null, 2)));
  });
});

function createRequest(
  overrides: Partial<ModelRequestEvent> = {},
): ModelRequestEvent {
  return {
    type: "model.request",
    sessionId: "sf_session_test",
    turnId: "sf_turn_test",
    requestId: "model-request-test",
    providerId: "deepseek",
    model: "deepseek-v4-pro",
    responseMode: "auto",
    messages: [],
    tools: [],
    ...overrides,
  };
}
