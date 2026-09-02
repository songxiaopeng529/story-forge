import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationTimeline } from "../conversation-timeline";
import type { TimelineItem } from "../../utils/timeline";

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

  it("opens table actions on opaque semantic surfaces and closes fullscreen with Escape", () => {
    const items: TimelineItem[] = [{
      type: "assistant-message",
      id: "assistant-table-actions",
      content: [
        "| Name | Value |",
        "| --- | --- |",
        "| Alpha | 100 |",
      ].join("\n"),
    }];

    render(<ConversationTimeline items={items} />);

    fireEvent.click(screen.getByRole("button", { name: "Download table" }));
    const csvAction = screen.getByRole("button", { name: "CSV" });
    const downloadMenu = csvAction.parentElement;
    expect(downloadMenu).toHaveClass("bg-background", "border-border", "shadow-lg");
    expect(csvAction).toHaveAttribute("title", "Download table as CSV");
    expect(screen.getByRole("button", { name: "Markdown" }))
      .toHaveAttribute("title", "Download table as Markdown");
    expect(screen.getByRole("button", { name: "Markdown" }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View fullscreen" }));
    const fullscreen = screen.getByRole("dialog", { name: "View fullscreen" });
    expect(fullscreen).toHaveAttribute("data-streamdown", "table-fullscreen");
    expect(fullscreen).toHaveClass("fixed", "inset-0", "bg-background");

    fireEvent.keyDown(fullscreen, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "View fullscreen" }))
      .not.toBeInTheDocument();
  });

  it("renders the pending assistant placeholder as an accessible shimmer status row", () => {
    const items: TimelineItem[] = [{
      type: "assistant-message",
      id: "pending-turn-1",
      content: "Thinking...",
      streaming: true,
      delivery: "smooth",
    }];

    render(<ConversationTimeline items={items} />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Thinking...");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).not.toHaveClass("bg-white");
    expect(screen.getByTestId("thinking-status").querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("uses an animated, accessible disclosure for completed reasoning", () => {
    const items: TimelineItem[] = [{
      type: "reasoning",
      id: "reasoning-1",
      content: "Inspect the timeline before changing it.",
    }];

    render(<ConversationTimeline items={items} />);

    const collapsed = screen.getByRole("button", { name: /Thought Completed/ });
    expect(collapsed).toHaveAttribute("aria-expanded", "false");
    const panelId = collapsed.getAttribute("aria-controls");
    expect(document.getElementById(panelId ?? "")).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(collapsed);

    const expanded = screen.getByRole("button", { name: /Reasoning Completed/ });
    expect(expanded).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(panelId ?? "")).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByText("Inspect the timeline before changing it.")).toBeInTheDocument();
  });

  it("groups consecutive tool steps into one compact, expandable activity section", () => {
    const items: TimelineItem[] = [
      {
        type: "tool-step",
        id: "tool-1",
        callId: "call-1",
        name: "workspace.readFile",
        status: "completed",
        input: { path: "README.md" },
        output: "StoryForge",
      },
      {
        type: "tool-step",
        id: "tool-2",
        callId: "call-2",
        name: "bash",
        status: "failed",
        input: { command: "pnpm missing" },
        output: "command failed",
      },
      {
        type: "tool-step",
        id: "tool-3",
        callId: "call-3",
        name: "web_search",
        status: "running",
        input: { query: "Beautiful UI" },
      },
    ];

    render(<ConversationTimeline items={items} />);

    expect(screen.getAllByTestId("tool-activity-group")).toHaveLength(1);
    const group = screen.getByRole("button", { name: /Tool activity 3 tools/ });
    expect(group).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("3 tools · 1 completed · 1 failed · 1 running")).toBeInTheDocument();
    expect(screen.getByText("Read file")).toBeInTheDocument();
    expect(screen.getByText("Run command")).toBeInTheDocument();
    expect(screen.getByText("Search the web")).toBeInTheDocument();

    const readFile = screen.getByRole("button", { name: /Read file README\.md Completed/ });
    expect(readFile).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(readFile);
    expect(readFile).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(readFile.getAttribute("aria-controls") ?? ""))
      .toHaveAttribute("aria-hidden", "false");
  });

  it("renders agent delegation as one aggregate summary card", () => {
    const items: TimelineItem[] = [{
      type: "delegate-summary",
      id: "delegate-1",
      callId: "call-delegate",
      status: "completed",
      taskCount: 2,
      objectives: ["Map the runtime", "Review cancellation"],
      resultStatus: "partial",
      completedCount: 1,
      failedCount: 1,
      cancelledCount: 0,
    }];

    render(<ConversationTimeline items={items} />);

    expect(screen.getAllByTestId("delegate-summary-card")).toHaveLength(1);
    expect(screen.getByRole("article", { name: "Agent delegation Partial" }))
      .toBeInTheDocument();
    expect(screen.getByText("2 child agents · 1 completed · 1 failed")).toBeInTheDocument();
    expect(screen.getByText("Map the runtime")).toBeInTheDocument();
    expect(screen.getByText("Review cancellation")).toBeInTheDocument();
    expect(screen.queryByTestId("tool-activity-group")).not.toBeInTheDocument();
  });

  it("maps coding and MCP tools to human-readable activity labels", () => {
    const tools: Array<[string, string]> = [
      ["write", "Write file"],
      ["edit", "Edit file"],
      ["grep", "Search text"],
      ["find", "Find files"],
      ["ls", "List directory"],
      ["web_fetch", "Fetch webpage"],
      ["mcp__github__list_issues", "Github · List issues"],
    ];
    const items: TimelineItem[] = tools.map(([name], index) => ({
      type: "tool-step",
      id: `tool-${index}`,
      callId: `call-${index}`,
      name,
      status: "completed",
    }));

    render(<ConversationTimeline items={items} />);
    fireEvent.click(screen.getByRole("button", { name: /Tool activity 7 tools/ }));

    for (const [, label] of tools) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("shows a copied confirmation after copying a completed assistant response", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const items: TimelineItem[] = [{
      type: "assistant-message",
      id: "assistant-complete",
      content: "The change is ready.",
    }];

    render(<ConversationTimeline items={items} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy assistant response" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("The change is ready."));
    expect(screen.getByRole("button", { name: "Assistant response copied" })).toHaveTextContent("Copied");
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

  it("renders completed PI plans as formatted plan cards", () => {
    const items: TimelineItem[] = [{
      type: "plan",
      id: "plan-1",
      content: "## Runtime migration\n\n1. Remove fake mode\n2. Load the PI extension",
    }];

    const { container } = render(<ConversationTimeline items={items} />);

    expect(screen.getByText("Proposed plan")).toBeInTheDocument();
    expect(container.querySelector("h2")).toHaveTextContent("Runtime migration");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders task rows without a redundant status icon", () => {
    const items: TimelineItem[] = [{
      type: "task-list",
      id: "tasks-1",
      tasks: [{
        id: "sf_task_1",
        title: "Wait for user direction",
        status: "pending",
        createdAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:00:00.000Z",
      }],
      completedCount: 0,
      totalCount: 1,
      blockedCount: 0,
    }];

    const { container } = render(<ConversationTimeline items={items} />);

    expect(screen.getByText("Wait for user direction")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });
});
