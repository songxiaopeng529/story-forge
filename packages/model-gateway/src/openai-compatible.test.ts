import { describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "./openai-compatible";

describe("OpenAICompatibleProvider", () => {
  it("exposes the canonical provider id and capabilities", () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-small",
      fetch: vi.fn(),
    });

    expect(provider.id).toBe("openai-compatible:story-forge-small");
    expect(provider.capabilities).toEqual({
      toolCalling: true,
      streaming: false,
      jsonSchema: true,
      contextWindowTokens: 128_000,
    });
  });

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

  it("accepts explicit empty JSON object tool arguments", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call_empty_object",
                    type: "function",
                    function: {
                      name: "refresh_outline",
                      arguments: "{}",
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

    await expect(provider.chat({ messages: [{ role: "user", content: "Refresh" }] })).resolves.toEqual({
      content: "",
      toolCalls: [{ id: "call_empty_object", name: "refresh_outline", input: {} }],
    });
  });

  it.each([
    {
      label: "missing",
      toolCall: {
        id: "call_missing_args",
        type: "function",
        function: {
          name: "repair_outline",
        },
      },
      error:
        "OpenAI-compatible provider returned invalid tool arguments for call call_missing_args: missing JSON object arguments",
    },
    {
      label: "empty",
      toolCall: {
        id: "call_empty_args",
        type: "function",
        function: {
          name: "repair_outline",
          arguments: "  ",
        },
      },
      error:
        "OpenAI-compatible provider returned invalid tool arguments for call call_empty_args: missing JSON object arguments",
    },
  ])("rejects $label tool call arguments", async ({ toolCall, error }) => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [toolCall],
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

    await expect(provider.chat({ messages: [{ role: "user", content: "Repair" }] })).rejects.toThrow(error);
  });

  it("rejects malformed tool call argument JSON", async () => {
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

    await expect(provider.chat({ messages: [{ role: "user", content: "Repair" }] })).rejects.toThrow(
      "OpenAI-compatible provider returned invalid tool arguments for call call_bad_json: expected JSON object arguments",
    );
  });

  it("rejects successful responses without a choice message", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [] })));
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-small",
      fetch,
    });

    await expect(provider.chat({ messages: [{ role: "user", content: "Hello" }] })).rejects.toThrow(
      "OpenAI-compatible provider returned an invalid response: missing choices[0].message",
    );
  });

  it.each([
    {
      label: "id",
      toolCall: {
        type: "function",
        function: {
          name: "read_file",
          arguments: "{}",
        },
      },
      error: "OpenAI-compatible provider returned an invalid tool call: missing id",
    },
    {
      label: "name",
      toolCall: {
        id: "call_missing_name",
        type: "function",
        function: {
          arguments: "{}",
        },
      },
      error: "OpenAI-compatible provider returned an invalid tool call call_missing_name: missing function.name",
    },
  ])("rejects tool calls missing $label", async ({ toolCall, error }) => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [toolCall],
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

    await expect(provider.chat({ messages: [{ role: "user", content: "Read" }] })).rejects.toThrow(error);
  });

  it("rejects tool arguments that parse to a non-object value", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_array_args",
                    type: "function",
                    function: {
                      name: "repair_outline",
                      arguments: "[\"not\", \"an\", \"object\"]",
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

    await expect(provider.chat({ messages: [{ role: "user", content: "Repair" }] })).rejects.toThrow(
      "OpenAI-compatible provider returned invalid tool arguments for call call_array_args: expected JSON object arguments",
    );
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
