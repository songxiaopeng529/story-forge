import type {
  ChatMessage,
  ChatOptions,
  ChatRequest,
  ChatResponse,
  ModelCapabilities,
  ModelProvider,
  ToolSchema,
  UserChatContent,
} from "./model-provider";

type FetchFunction = (input: string, init: RequestInit) => Promise<Response>;

export type AnthropicProviderOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetch?: FetchFunction;
  maxTokens?: number;
};

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
};

export class AnthropicProvider implements ModelProvider {
  readonly id: string;
  readonly capabilities: ModelCapabilities = {
    toolCalling: true,
    streaming: false,
    jsonSchema: true,
    contextWindowTokens: 200_000,
  };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetch: FetchFunction;
  private readonly maxTokens: number;
  private readonly model: string;

  constructor(options: AnthropicProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxTokens = options.maxTokens ?? 8_192;
    this.model = options.model;
    this.id = `anthropic:${options.model}`;
  }

  async chat(request: ChatRequest, options: ChatOptions = {}): Promise<ChatResponse> {
    const toolNameMap = createToolNameMap(request.tools ?? []);
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const messages = toAnthropicMessages(
      request.messages.filter((message) => message.role !== "system"),
      toolNameMap,
    );
    const response = await this.fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        ...(system ? { system } : {}),
        messages,
        ...(request.tools?.length
          ? {
              tools: request.tools.map((tool) => ({
                name: sanitizeToolName(tool.name),
                description: tool.description,
                input_schema: tool.parameters,
              })),
            }
          : {}),
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      throw new Error(await createAnthropicError(response));
    }

    const payload = (await response.json()) as AnthropicResponse;
    if (!Array.isArray(payload.content)) {
      throw new Error("Anthropic provider returned an invalid response: missing content");
    }

    const text = payload.content
      .filter((block): block is Extract<AnthropicContentBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("");
    const reasoningContent = payload.content
      .filter(
        (block): block is Extract<AnthropicContentBlock, { type: "thinking" }> =>
          block.type === "thinking",
      )
      .map((block) => block.thinking)
      .join("\n");
    const toolCalls = payload.content
      .filter(
        (block): block is Extract<AnthropicContentBlock, { type: "tool_use" }> =>
          block.type === "tool_use",
      )
      .map((block) => ({
        id: block.id,
        name: toolNameMap.get(block.name) ?? block.name,
        input: block.input,
      }));
    return {
      content: text,
      ...(reasoningContent ? { reasoningContent } : {}),
      toolCalls,
    };
  }
}

function toAnthropicMessage(message: Exclude<ChatMessage, { role: "system" }>, toolNameMap: Map<string, string>) {
  if (message.role === "assistant") {
    const content: Array<Record<string, unknown>> = [];
    if (message.content) {
      content.push({ type: "text", text: message.content });
    }
    for (const toolCall of message.toolCalls ?? []) {
      content.push({
        type: "tool_use",
        id: toolCall.id,
        name: sanitizeToolName(toolCall.name),
        input: toolCall.input,
      });
    }
    return { role: "assistant", content };
  }

  if (message.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content,
        },
      ],
    };
  }

  return { role: "user", content: toAnthropicUserContent(message.content) };
}

function toAnthropicUserContent(messageContent: UserChatContent): unknown {
  if (typeof messageContent === "string") {
    return messageContent;
  }
  return messageContent.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: part.mediaType,
        data: part.data,
      },
    };
  });
}

function toAnthropicMessages(
  messages: Array<Exclude<ChatMessage, { role: "system" }>>,
  toolNameMap: Map<string, string>,
): Array<{ role: string; content: unknown }> {
  const result: Array<{ role: string; content: unknown }> = [];
  for (const message of messages) {
    const converted = toAnthropicMessage(message, toolNameMap);
    const previous = result.at(-1);
    if (
      message.role === "tool"
      && previous?.role === "user"
      && Array.isArray(previous.content)
      && previous.content.every(isToolResultBlock)
      && Array.isArray(converted.content)
    ) {
      previous.content.push(...converted.content);
    } else {
      result.push(converted);
    }
  }
  return result;
}

function isToolResultBlock(value: unknown): boolean {
  return Boolean(
    value
    && typeof value === "object"
    && "type" in value
    && value.type === "tool_result",
  );
}

function createToolNameMap(tools: ToolSchema[]): Map<string, string> {
  return new Map(tools.map((tool) => [sanitizeToolName(tool.name), tool.name]));
}

function sanitizeToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_") || "_";
}

async function createAnthropicError(response: Response): Promise<string> {
  const body = (await response.text()).trim();
  const statusText = response.statusText ? ` ${response.statusText}` : "";
  return `Anthropic provider request failed: ${response.status}${statusText}${body ? ` - ${body}` : ""}`;
}
