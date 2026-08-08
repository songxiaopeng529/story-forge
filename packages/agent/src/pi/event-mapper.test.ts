import { describe, expect, it } from "vitest";
import {
  errorMessageFromPiMessages,
  normalizeModelRequestPayload,
} from "./event-mapper";

describe("normalizeModelRequestPayload", () => {
  it("materializes Anthropic system blocks and tool schemas for Inspector", () => {
    const result = normalizeModelRequestPayload({
      system: [
        { type: "text", text: "PI base system prompt" },
        { type: "text", text: "StoryForge skills and harness instructions" },
      ],
      messages: [{ role: "user", content: "Inspect this workspace" }],
      tools: [
        {
          name: "read",
          description: "Read a file",
          input_schema: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
    });

    expect(result.messages).toEqual([
      {
        role: "system",
        content: "PI base system prompt\nStoryForge skills and harness instructions",
      },
      { role: "user", content: "Inspect this workspace" },
    ]);
    expect(result.tools).toEqual([
      {
        name: "read",
        description: "Read a file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ]);
  });

  it("normalizes OpenAI function tools without duplicating an existing system message", () => {
    const result = normalizeModelRequestPayload({
      system: "duplicate provider system",
      messages: [{ role: "system", content: "outbound system" }],
      tools: [{
        type: "function",
        function: {
          name: "task_list",
          description: "List StoryForge tasks",
          parameters: { type: "object", properties: {} },
        },
      }],
    });

    expect(result.messages).toEqual([{ role: "system", content: "outbound system" }]);
    expect(result.tools[0]).toMatchObject({
      name: "task_list",
      parameters: { type: "object", properties: {} },
    });
  });

  it("extracts the provider error from the last failed assistant message", () => {
    expect(errorMessageFromPiMessages([
      { role: "assistant", stopReason: "error", errorMessage: "first failure" },
      { role: "user", content: "retry" },
      { role: "assistant", stopReason: "error", errorMessage: "invalid tool name" },
    ])).toBe("invalid tool name");
  });
});
