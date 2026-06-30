import { describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "../model-provider";
import { OpenAICompatibleProvider } from "../openai-compatible";

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  );
}

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
      streaming: true,
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

  it("serializes image content blocks as OpenAI-compatible image_url data URLs", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "It is a diagram." } }] })),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-vision",
      fetch,
    });

    await provider.chat({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this image?" },
            {
              type: "image",
              mediaType: "image/png",
              data: "iVBORw0KGgo=",
              filename: "diagram.png",
            },
          ],
        },
      ],
    });

    const [, requestInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this image?" },
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,iVBORw0KGgo=",
              },
            },
          ],
        },
      ],
    });
  });

  it("maps StoryForge tool names to OpenAI-safe function names and maps returned calls back", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call_workspace_read",
                    type: "function",
                    function: {
                      name: "workspace_readFile",
                      arguments: "{\"path\":\"README.md\"}",
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

    const response = await provider.chat({
      messages: [{ role: "user", content: "Read README" }],
      tools: [
        {
          name: "workspace.readFile",
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

    const [, requestInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      tools: [
        {
          type: "function",
          function: {
            name: "workspace_readFile",
            description: "Read a workspace file",
          },
        },
      ],
    });
    expect(response.toolCalls).toEqual([
      {
        id: "call_workspace_read",
        name: "workspace.readFile",
        input: { path: "README.md" },
      },
    ]);
  });

  it("rejects duplicate OpenAI-safe tool names in a single request", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] })));
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-small",
      fetch,
    });

    await expect(
      provider.chat({
        messages: [{ role: "user", content: "Read README" }],
        tools: [
          {
            name: "workspace.readFile",
            description: "Read a workspace file",
            parameters: { type: "object" },
          },
          {
            name: "workspace/readFile",
            description: "Read another workspace file",
            parameters: { type: "object" },
          },
        ],
      }),
    ).rejects.toThrow(
      "OpenAI-compatible tool name collision: workspace/readFile and workspace.readFile both normalize to workspace_readFile",
    );
    expect(fetch).not.toHaveBeenCalled();
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

  it("replays assistant tool calls, tool results, reasoning content, and forwards cancellation", async () => {
    const fetch = vi.fn(async (_input: string, init: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "done",
                reasoning_content: "verified the result",
              },
            },
          ],
        }),
      ),
    );
    const controller = new AbortController();
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-reasoning",
      fetch,
      extraBody: {
        thinking: { type: "enabled" },
        reasoning_effort: "max",
      },
    });

    const response = await provider.chat(
      {
        messages: [
          { role: "user", content: "Read README" },
          {
            role: "assistant",
            content: "",
            reasoningContent: "I need the file",
            toolCalls: [{ id: "call_1", name: "workspace.readFile", input: { path: "README.md" } }],
          },
          {
            role: "tool",
            content: "StoryForge",
            name: "workspace.readFile",
            toolCallId: "call_1",
          },
        ],
      },
      { signal: controller.signal },
    );

    const [, requestInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestInit.signal).toBe(controller.signal);
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "max",
      messages: [
        { role: "user", content: "Read README" },
        {
          role: "assistant",
          content: "",
          reasoning_content: "I need the file",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "workspace_readFile",
                arguments: "{\"path\":\"README.md\"}",
              },
            },
          ],
        },
        {
          role: "tool",
          content: "StoryForge",
          name: "workspace.readFile",
          tool_call_id: "call_1",
        },
      ],
    });
    expect(response).toEqual({
      content: "done",
      reasoningContent: "verified the result",
      toolCalls: [],
    });
  });

  it("streams content deltas and returns the accumulated response", async () => {
    const fetch = vi.fn(async () =>
      streamResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo","reasoning_content":"thinking"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-small",
      fetch,
      headers: { "x-provider": "story-forge" },
      extraBody: { reasoning_effort: "high", stream: false },
    });
    const controller = new AbortController();

    const events: unknown[] = [];
    for await (const event of provider.streamChat(
      {
        messages: [{ role: "user", content: "Say hello" }],
      },
      { signal: controller.signal },
    )) {
      events.push(event);
    }

    const [, requestInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestInit.signal).toBe(controller.signal);
    expect(requestInit.headers).toMatchObject({
      authorization: "Bearer sf_test_key",
      "content-type": "application/json",
      "x-provider": "story-forge",
    });
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      model: "story-forge-small",
      messages: [{ role: "user", content: "Say hello" }],
      reasoning_effort: "high",
      stream: true,
    });
    expect(events).toEqual([
      { type: "content.delta", content: "Hel" },
      { type: "content.delta", content: "lo" },
      { type: "reasoning.delta", content: "thinking" },
      {
        type: "done",
        response: {
          content: "Hello",
          reasoningContent: "thinking",
          toolCalls: [],
        },
      },
    ]);
  });

  it("reconstructs streamed tool calls from argument chunks", async () => {
    const fetch = vi.fn(async () =>
      streamResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"workspace_readFile","arguments":"{\\"path\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"README.md\\"}"}}]}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-small",
      fetch,
    });

    const events: unknown[] = [];
    for await (const event of provider.streamChat({
      messages: [{ role: "user", content: "Read" }],
      tools: [
        {
          name: "workspace.readFile",
          description: "Read a workspace file",
          parameters: { type: "object" },
        },
      ],
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({
      type: "done",
      response: {
        content: "",
        toolCalls: [
          {
            id: "call_1",
            name: "workspace.readFile",
            input: { path: "README.md" },
          },
        ],
      },
    });
    expect(events).toContainEqual({
      type: "tool.call",
      toolCall: {
        id: "call_1",
        name: "workspace.readFile",
        input: { path: "README.md" },
      },
    });
  });

  it("rejects streams that end without the DONE marker after deltas", async () => {
    const fetch = vi.fn(async () =>
      streamResponse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-small",
      fetch,
    });

    const events: unknown[] = [];
    await expect(
      (async () => {
        for await (const event of provider.streamChat({
          messages: [{ role: "user", content: "Say something" }],
        })) {
          events.push(event);
        }
      })(),
    ).rejects.toThrow("OpenAI-compatible provider returned an invalid stream: missing [DONE] marker");
    expect(events).toEqual([{ type: "content.delta", content: "partial" }]);
  });

  it("ignores malformed stream data after DONE", async () => {
    const fetch = vi.fn(async () =>
      streamResponse([
        'data: {"choices":[{"delta":{"content":"safe"}}]}\n\n',
        "data: [DONE]\n\n",
        "data: {not json}\n\n",
      ]),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-small",
      fetch,
    });

    const events: unknown[] = [];
    for await (const event of provider.streamChat({
      messages: [{ role: "user", content: "Say something" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content.delta", content: "safe" },
      {
        type: "done",
        response: {
          content: "safe",
          toolCalls: [],
        },
      },
    ]);
  });

  it("parses valid SSE frames split across chunks", async () => {
    const fetch = vi.fn(async () =>
      streamResponse([
        'data: {"choices":[{"delta":{"content":"split',
        '"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-small",
      fetch,
    });

    const events: unknown[] = [];
    for await (const event of provider.streamChat({
      messages: [{ role: "user", content: "Say something" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content.delta", content: "split" },
      {
        type: "done",
        response: {
          content: "split",
          toolCalls: [],
        },
      },
    ]);
  });

  it("joins multi-line SSE data fields before parsing JSON", async () => {
    const fetch = vi.fn(async () =>
      streamResponse([
        'data: {"choices":\n',
        'data: [{"delta":{"content":"multi-line"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-small",
      fetch,
    });

    const events: unknown[] = [];
    for await (const event of provider.streamChat({
      messages: [{ role: "user", content: "Say something" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content.delta", content: "multi-line" },
      {
        type: "done",
        response: {
          content: "multi-line",
          toolCalls: [],
        },
      },
    ]);
  });

  it("accepts a final DONE frame without a trailing blank delimiter", async () => {
    const fetch = vi.fn(async () =>
      streamResponse(['data: {"choices":[{"delta":{"content":"final"}}]}\n\n', "data: [DONE]"]),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-small",
      fetch,
    });

    const events: unknown[] = [];
    for await (const event of provider.streamChat({
      messages: [{ role: "user", content: "Say something" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content.delta", content: "final" },
      {
        type: "done",
        response: {
          content: "final",
          toolCalls: [],
        },
      },
    ]);
  });

  it("rejects a final non-DONE frame without a trailing blank delimiter", async () => {
    const fetch = vi.fn(async () =>
      streamResponse(['data: {"choices":[{"delta":{"content":"unterminated"}}]}']),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-small",
      fetch,
    });

    const events: unknown[] = [];
    await expect(
      (async () => {
        for await (const event of provider.streamChat({
          messages: [{ role: "user", content: "Say something" }],
        })) {
          events.push(event);
        }
      })(),
    ).rejects.toThrow("OpenAI-compatible provider returned an invalid stream: missing [DONE] marker");
    expect(events).toEqual([{ type: "content.delta", content: "unterminated" }]);
  });

  it("parses token usage from non-streaming completions", async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Hi" } }],
          usage: { prompt_tokens: 1200, completion_tokens: 34, total_tokens: 1234 },
        }),
      ),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-small",
      fetch,
    });

    const response = await provider.chat({ messages: [{ role: "user", content: "Hi" }] });

    expect(response.usage).toEqual({
      promptTokens: 1200,
      completionTokens: 34,
      totalTokens: 1234,
    });
  });

  it("requests and parses token usage from streamed completions", async () => {
    const fetch = vi.fn(async () =>
      streamResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":900,"completion_tokens":12,"total_tokens":912}}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const provider = new OpenAICompatibleProvider({
      apiKey: "sf_test_key",
      baseUrl: "https://models.example.test/v1",
      model: "story-forge-small",
      fetch,
    });

    const events: ChatStreamEvent[] = [];
    for await (const event of provider.streamChat({
      messages: [{ role: "user", content: "Hi" }],
    })) {
      events.push(event);
    }

    const [, requestInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
    const done = events.at(-1);
    expect(done).toEqual({
      type: "done",
      response: {
        content: "Hi",
        toolCalls: [],
        usage: { promptTokens: 900, completionTokens: 12, totalTokens: 912 },
      },
    });
  });
});
