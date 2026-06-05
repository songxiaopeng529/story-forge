import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the StoryForge agent workspace", () => {
    render(<App />);

    expect(screen.getByText("StoryForge")).toBeInTheDocument();
    expect(screen.getByText("Agent Core")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask StoryForge to inspect, explain, or change code...")).toBeInTheDocument();
  });
});
