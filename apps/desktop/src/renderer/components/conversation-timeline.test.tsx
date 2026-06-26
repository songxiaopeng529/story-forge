import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationTimeline } from "./conversation-timeline";
import type { TimelineItem } from "../timeline";

afterEach(() => {
  cleanup();
});

describe("ConversationTimeline assistant markdown", () => {
  it("renders assistant markdown as formatted elements, not raw syntax", () => {
    const items: TimelineItem[] = [
      {
        type: "assistant-message",
        id: "assistant-1",
        content: [
          "# Heading",
          "",
          "Some **bold** text.",
          "",
          "| Name | Value |",
          "| --- | --- |",
          "| Alpha | 100 |",
          "",
          "```ts",
          "const a = 1;",
          "```",
        ].join("\n"),
      },
    ];

    const { container } = render(<ConversationTimeline items={items} />);

    expect(container.querySelector("h1")).toHaveTextContent("Heading");
    expect(container.querySelector("[data-streamdown=\"strong\"]")).toHaveTextContent("bold");
    expect(container.querySelector("table")).toBeInTheDocument();
    expect(container.querySelector("pre")).toBeInTheDocument();
    expect(container.textContent).not.toContain("**bold**");
  });

  it("renders a streaming message with an unterminated code fence without throwing", () => {
    const items: TimelineItem[] = [
      {
        type: "assistant-message",
        id: "assistant-stream",
        streaming: true,
        delivery: "live",
        content: "Here is code:\n\n```ts\nconst a =",
      },
    ];

    const { container } = render(<ConversationTimeline items={items} />);

    expect(container.querySelector("pre")).toBeInTheDocument();
    expect(container.textContent).toContain("const a =");
  });

  it("renders user messages as plain text without markdown processing", () => {
    const items: TimelineItem[] = [
      {
        type: "user-message",
        id: "user-1",
        content: "Show me **not bold** please",
      },
    ];

    const { container } = render(<ConversationTimeline items={items} />);

    expect(screen.getByText("Show me **not bold** please")).toBeInTheDocument();
    expect(container.querySelector("strong")).not.toBeInTheDocument();
  });
});
