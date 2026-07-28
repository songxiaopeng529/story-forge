import type { ChatMessage } from "@story-forge/model-gateway";
import { describe, expect, it } from "vitest";
import {
  estimateMessageTokens,
  estimateMessagesTokens,
  trimMessagesToContext,
} from "../message-context";

describe("message context utilities", () => {
  it("keeps system messages and newest complete conversation rounds within budget", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "new question" },
      { role: "assistant", content: "new answer" },
    ];

    const trimmed = trimMessagesToContext(messages, 6, () => 2);

    expect(trimmed).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "new question" },
      { role: "assistant", content: "new answer" },
    ]);
  });

  it("estimates messages from serialized size", () => {
    const message: ChatMessage = { role: "user", content: "hello" };

    expect(estimateMessagesTokens([message])).toBe(estimateMessageTokens(message));
    expect(estimateMessageTokens(message)).toBeGreaterThan(0);
  });
});
