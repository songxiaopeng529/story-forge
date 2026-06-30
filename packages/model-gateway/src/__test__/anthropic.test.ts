import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../anthropic";

describe("AnthropicProvider", () => {
  it("maps system, assistant tool calls, and tool results to the Messages API", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [
            { type: "thinking", thinking: "checked the workspace" },
            { type: "text", text: "done" },
            {
              type: "tool_use",
              id: "tool_2",
              name: "workspace_readFile",
              input: { path: "package.json" },
            },
          ],
        }),
      ),
    );
    const provider = new AnthropicProvider({
      apiKey: "claude_test_key",
      baseUrl: "https://api.anthropic.com",
      model: "claude-test",
      fetch,
    });

    const response = await provider.chat({
      messages: [
        { role: "system", content: "You are StoryForge." },
        { role: "user", content: "Inspect the project." },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "tool_1", name: "workspace.readFile", input: { path: "README.md" } }],
        },
        {
          role: "tool",
          content: "StoryForge",
          name: "workspace.readFile",
          toolCallId: "tool_1",
        },
        {
          role: "tool",
          content: "package contents",
          name: "workspace.readFile",
          toolCallId: "tool_1b",
        },
      ],
      tools: [
        {
          name: "workspace.readFile",
          description: "Read a file",
          parameters: { type: "object" },
        },
      ],
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: {
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          "x-api-key": "claude_test_key",
        },
      }),
    );
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "claude-test",
      system: "You are StoryForge.",
      messages: [
        { role: "user", content: "Inspect the project." },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "workspace_readFile",
              input: { path: "README.md" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              content: "StoryForge",
            },
            {
              type: "tool_result",
              tool_use_id: "tool_1b",
              content: "package contents",
            },
          ],
        },
      ],
    });
    expect(response).toEqual({
      content: "done",
      reasoningContent: "checked the workspace",
      toolCalls: [{ id: "tool_2", name: "workspace.readFile", input: { path: "package.json" } }],
    });
  });

  it("serializes image content blocks as Claude image sources", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "It is a screenshot." }] })),
    );
    const provider = new AnthropicProvider({
      apiKey: "claude_test_key",
      baseUrl: "https://api.anthropic.com",
      model: "claude-vision-test",
      fetch,
    });

    await provider.chat({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image." },
            {
              type: "image",
              mediaType: "image/jpeg",
              data: "/9j/4AAQSkZJRg==",
              filename: "screen.jpg",
            },
          ],
        },
      ],
    });

    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image." },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: "/9j/4AAQSkZJRg==",
              },
            },
          ],
        },
      ],
    });
  });

  it("parses token usage from the Messages API", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "Hi" }],
          usage: { input_tokens: 4096, output_tokens: 128 },
        }),
      ),
    );
    const provider = new AnthropicProvider({
      apiKey: "claude_test_key",
      baseUrl: "https://api.anthropic.com",
      model: "claude-test",
      fetch,
    });

    const response = await provider.chat({ messages: [{ role: "user", content: "Hi" }] });

    expect(response.usage).toEqual({
      promptTokens: 4096,
      completionTokens: 128,
      totalTokens: 4224,
    });
  });
});
