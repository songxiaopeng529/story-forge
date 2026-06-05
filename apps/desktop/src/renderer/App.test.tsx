import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  cleanup();
});

describe("App", () => {
  it("renders the StoryForge agent workspace", () => {
    render(<App />);

    expect(screen.getByText("StoryForge")).toBeInTheDocument();
    expect(screen.getByText("Agent Core")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask StoryForge to inspect, explain, or change code...")).toBeInTheDocument();
  });

  it("runs a desktop agent turn through the preload bridge", async () => {
    const runTurn = vi.fn(async () => [{ type: "message.delta", content: "ready" }]);
    Object.defineProperty(window, "storyForge", {
      configurable: true,
      value: {
        version: "0.1.0",
        runTurn,
      },
    });

    render(<App />);
    fireEvent.change(screen.getByPlaceholderText("Ask StoryForge to inspect, explain, or change code..."), {
      target: { value: "Say ready" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Say ready" })));
    expect(screen.getByText(/message.delta/)).toBeInTheDocument();
  });
});
