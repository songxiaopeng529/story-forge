import type { ChatMessage } from "@story-forge/model-gateway";
import type { SessionTask } from "@story-forge/shared";
import { describe, expect, it, vi } from "vitest";
import { ContextCompactor, type CompactionSummarize } from "../context-compactor";

const systemMessage: ChatMessage = { role: "system", content: "You are StoryForge." };

function fakeSummarize(text: string) {
  return vi.fn<CompactionSummarize>(async () => text);
}

function contentToText(message: ChatMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function round(index: number): ChatMessage[] {
  return [
    { role: "user", content: `user-${index}` },
    { role: "assistant", content: `assistant-${index}` },
  ];
}

describe("ContextCompactor", () => {
  it("collapses older rounds into a summary and retains the recent tail", async () => {
    const summarize = fakeSummarize("结构化摘要");
    const messages: ChatMessage[] = [systemMessage, ...round(1), ...round(2), ...round(3)];

    const result = await new ContextCompactor().compact({
      messages,
      openTasks: [],
      retainRounds: 1,
      summarize,
    });

    expect(result.compacted).toBe(true);
    expect(result.retainedRounds).toBe(1);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(result.messages).toEqual([
      systemMessage,
      { role: "assistant", content: "结构化摘要", kind: "summary" },
      { role: "user", content: "user-3" },
      { role: "assistant", content: "assistant-3" },
    ]);
  });

  it("only summarizes the rounds before the retained tail", async () => {
    const summarize = fakeSummarize("摘要");
    const messages: ChatMessage[] = [systemMessage, ...round(1), ...round(2), ...round(3)];

    await new ContextCompactor().compact({
      messages,
      openTasks: [],
      retainRounds: 1,
      summarize,
    });

    const summaryRequest: ChatMessage[] = summarize.mock.calls[0]![0].messages;
    const contents = summaryRequest.map((message) => contentToText(message));
    expect(contents).toContain("assistant-1");
    expect(contents).toContain("assistant-2");
    expect(contents).not.toContain("assistant-3");
  });

  it("injects open tasks into the summary instruction", async () => {
    const summarize = fakeSummarize("摘要");
    const openTasks: SessionTask[] = [
      {
        id: "sf_task_a",
        title: "实现压缩",
        status: "in_progress",
        createdAt: "2026-06-24T00:00:00.000Z",
        updatedAt: "2026-06-24T00:00:00.000Z",
      },
    ];

    await new ContextCompactor().compact({
      messages: [systemMessage, ...round(1), ...round(2)],
      openTasks,
      retainRounds: 1,
      summarize,
    });

    const summaryRequest: ChatMessage[] = summarize.mock.calls[0]![0].messages;
    const instruction = summaryRequest.at(-1);
    expect(instruction ? contentToText(instruction) : "").toContain("实现压缩");
    expect(instruction ? contentToText(instruction) : "").toContain("in_progress");
  });

  it("is a no-op when history is too short to compact", async () => {
    const summarize = fakeSummarize("摘要");
    const messages: ChatMessage[] = [systemMessage, ...round(1)];

    const result = await new ContextCompactor().compact({
      messages,
      openTasks: [],
      retainRounds: 1,
      summarize,
    });

    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages);
    expect(summarize).not.toHaveBeenCalled();
  });
});
