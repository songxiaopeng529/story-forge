import { describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "./openai-compatible";

describe("OpenAICompatibleProvider", () => {
  it("posts chat completions with normalized base URL and parses content with tool calls", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "I'll inspect the file.",
                tool_calls: [
                  {
                    id: "call_123",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: "{\"path\":\"README.md\"}",
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1/",
      model: "story-forge-small",
      fetch,
    });

    const response = await provider.chat({
      messages: [{ role: "user", content: "Read README" }],
      tools: [
        {
          name: "read_file",
          description: "Read a workspace file",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
          },
        },
      ],
    });

    expect(fetch).toHaveBeenCalledWith("https://models.example.test/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer sf_test_key",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "story-forge-small",
        messages: [{ role: "user", content: "Read README" }],
        tools: [
          {
            type: "function",
            function: {
              name: "read_file",
              description: "Read a workspace file",
              parameters: {
                type: "object",
                properties: {
                  path: { type: "string" },
                },
                required: ["path"],
              },
            },
          },
        ],
      }),
    });
    expect(response).toEqual({
      content: "I'll inspect the file.",
      toolCalls: [{ id: "call_123", name: "read_file", input: { path: "README.md" } }],
    });
  });

  it("defaults malformed tool call arguments to an empty input object", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_bad_json",
                    type: "function",
                    function: {
                      name: "repair_outline",
                      arguments: "{not json",
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-small",
      fetch,
    });

    await expect(provider.chat({ messages: [{ role: "user", content: "Repair" }] })).resolves.toEqual({
      content: "",
      toolCalls: [{ id: "call_bad_json", name: "repair_outline", input: {} }],
    });
  });

  it("throws a useful error when the provider returns a non-ok status", async () => {
    const fetch = vi.fn(async () => new Response("quota exhausted", { status: 429, statusText: "Too Many Requests" }));
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-small",
      fetch,
    });

    await expect(provider.chat({ messages: [{ role: "user", content: "Hello" }] })).rejects.toThrow(
      "OpenAI-compatible provider request failed: 429 Too Many Requests - quota exhausted",
    );
  });
});
