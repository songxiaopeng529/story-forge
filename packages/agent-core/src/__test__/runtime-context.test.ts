import type { ChatMessage } from "@story-forge/model-gateway";
import { describe, expect, it } from "vitest";
import { toRuntimePersistedMessages, type RuntimePersistedMessage } from "../runtime-context";

const fixedNow = () => "2026-06-24T00:00:00.000Z";

describe("toRuntimePersistedMessages", () => {
  it("reuses ids by stable signature after the message list is reshaped", () => {
    const previous: RuntimePersistedMessage[] = [
      { id: "user-1", role: "user", content: "first request", createdAt: "2026-06-23T00:00:00.000Z" },
      { id: "assistant-1", role: "assistant", content: "old answer", createdAt: "2026-06-23T00:01:00.000Z" },
      {
        id: "tool-1",
        role: "tool",
        content: "tool output",
        name: "workspace.readFile",
        toolCallId: "call_1",
        ok: true,
        createdAt: "2026-06-23T00:02:00.000Z",
      },
      { id: "user-2", role: "user", content: "second request", createdAt: "2026-06-23T00:03:00.000Z" },
      { id: "assistant-2", role: "assistant", content: "latest answer", createdAt: "2026-06-23T00:04:00.000Z" },
    ];

    const compacted: ChatMessage[] = [
      { role: "system", content: "system prompt" },
      { role: "assistant", content: "结构化摘要", kind: "summary" },
      { role: "user", content: "second request" },
      { role: "assistant", content: "latest answer" },
    ];

    const result = toRuntimePersistedMessages(compacted, previous, new Map(), fixedNow);

    expect(result).toHaveLength(3);
    const [summary, user, assistant] = result;
    expect(summary?.role).toBe("assistant");
    expect(summary?.role === "assistant" ? summary.kind : undefined).toBe("summary");
    expect(summary?.id).not.toBe("assistant-1");
    expect(summary?.createdAt).toBe(fixedNow());
    expect(user?.id).toBe("user-2");
    expect(user?.createdAt).toBe("2026-06-23T00:03:00.000Z");
    expect(assistant?.id).toBe("assistant-2");
  });

  it("preserves tool ids and ok flags through reshaping", () => {
    const previous: RuntimePersistedMessage[] = [
      { id: "user-1", role: "user", content: "do it", createdAt: "2026-06-23T00:00:00.000Z" },
      {
        id: "tool-1",
        role: "tool",
        content: "output",
        name: "workspace.readFile",
        toolCallId: "call_42",
        ok: true,
        createdAt: "2026-06-23T00:02:00.000Z",
      },
    ];

    const messages: ChatMessage[] = [
      { role: "user", content: "do it" },
      { role: "tool", content: "output", name: "workspace.readFile", toolCallId: "call_42" },
    ];

    const result = toRuntimePersistedMessages(messages, previous, new Map(), fixedNow);

    const tool = result.find((message) => message.role === "tool");
    expect(tool?.id).toBe("tool-1");
    expect(tool?.role === "tool" ? tool.ok : undefined).toBe(true);
    expect(tool?.createdAt).toBe("2026-06-23T00:02:00.000Z");
  });
});
