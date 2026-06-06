import type {
  ChatMessage,
  ChatOptions,
  ChatRequest,
  ChatResponse,
  ModelCapabilities,
  ModelProvider,
  ToolSchema,
} from "./model-provider";

type FetchFunction = (input: string, init: RequestInit) => Promise<Response>;

export type OpenAICompatibleProviderOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetch?: FetchFunction;
  capabilities?: Partial<ModelCapabilities>;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
};

type OpenAICompatibleTool = {
  type: "function";
  function: ToolSchema;
};

type OpenAICompatibleToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type OpenAICompatibleChatCompletion = {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: OpenAICompatibleToolCall[];
    };
  }>;
};

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly capabilities: ModelCapabilities;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetch: FetchFunction;
  private readonly model: string;
  private readonly headers: Record<string, string>;
  private readonly extraBody: Record<string, unknown>;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.model = options.model;
    this.headers = options.headers ?? {};
    this.extraBody = options.extraBody ?? {};
    this.id = `openai-compatible:${options.model}`;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.capabilities = {
      toolCalling: options.capabilities?.toolCalling ?? true,
      streaming: options.capabilities?.streaming ?? false,
      jsonSchema: options.capabilities?.jsonSchema ?? true,
      contextWindowTokens: options.capabilities?.contextWindowTokens ?? 128_000,
    };
  }

  async chat(request: ChatRequest, options: ChatOptions = {}): Promise<ChatResponse> {
    const toolNameMap = createToolNameMap(request.tools ?? []);
    const response = await this.fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        ...this.headers,
      },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages.map((message) => toOpenAICompatibleMessage(message, toolNameMap)),
        ...(request.tools ? { tools: request.tools.map((tool) => toOpenAICompatibleTool(tool, toolNameMap)) } : {}),
        ...this.extraBody,
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      throw new Error(await createProviderError(response));
    }

    const completion = (await response.json()) as OpenAICompatibleChatCompletion;
    const message = completion.choices?.[0]?.message;
    if (!message) {
      throw new Error("OpenAI-compatible provider returned an invalid response: missing choices[0].message");
    }

    const result: ChatResponse = {
      content: message.content ?? "",
      toolCalls: message.tool_calls?.map((toolCall) => parseToolCall(toolCall, toolNameMap)) ?? [],
    };
    if (message.reasoning_content) {
      result.reasoningContent = message.reasoning_content;
    }
    return result;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function toOpenAICompatibleMessage(
  message: ChatMessage,
  toolNameMap: Map<string, string>,
): Record<string, unknown> {
  if (message.role === "assistant") {
    return {
      role: message.role,
      content: message.content,
      ...(message.reasoningContent ? { reasoning_content: message.reasoningContent } : {}),
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function",
              function: {
                name: sanitizeToolName(toolCall.name),
                arguments: JSON.stringify(toolCall.input),
              },
            })),
          }
        : {}),
    };
  }

  if (message.role === "tool") {
    return {
      role: message.role,
      content: message.content,
      name: message.name,
      tool_call_id: message.toolCallId,
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

function toOpenAICompatibleTool(tool: ToolSchema, toolNameMap: Map<string, string>): OpenAICompatibleTool {
  const safeName = sanitizeToolName(tool.name);
  if (!toolNameMap.has(safeName)) {
    throw new Error(`OpenAI-compatible provider could not map tool name: ${tool.name}`);
  }

  return {
    type: "function",
    function: {
      ...tool,
      name: safeName,
    },
  };
}

function parseToolCall(toolCall: OpenAICompatibleToolCall, toolNameMap: Map<string, string>) {
  if (!toolCall.id) {
    throw new Error("OpenAI-compatible provider returned an invalid tool call: missing id");
  }

  if (!toolCall.function?.name) {
    throw new Error(`OpenAI-compatible provider returned an invalid tool call ${toolCall.id}: missing function.name`);
  }

  const originalName = toolNameMap.get(toolCall.function.name) ?? toolCall.function.name;

  return {
    id: toolCall.id,
    name: originalName,
    input: parseToolArguments(toolCall.id, toolCall.function.arguments),
  };
}

function createToolNameMap(tools: ToolSchema[]): Map<string, string> {
  const toolNameMap = new Map<string, string>();

  for (const tool of tools) {
    const safeName = sanitizeToolName(tool.name);
    const existingName = toolNameMap.get(safeName);
    if (existingName && existingName !== tool.name) {
      throw new Error(
        `OpenAI-compatible tool name collision: ${tool.name} and ${existingName} both normalize to ${safeName}`,
      );
    }

    toolNameMap.set(safeName, tool.name);
  }

  return toolNameMap;
}

function sanitizeToolName(toolName: string): string {
  const safeName = toolName.replace(/[^A-Za-z0-9_-]/g, "_");
  return safeName || "_";
}

function parseToolArguments(toolCallId: string, argumentsText: string | undefined): Record<string, unknown> {
  if (!argumentsText?.trim()) {
    throw new Error(
      `OpenAI-compatible provider returned invalid tool arguments for call ${toolCallId}: missing JSON object arguments`,
    );
  }

  try {
    const parsed = JSON.parse(argumentsText) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    throw new Error(
      `OpenAI-compatible provider returned invalid tool arguments for call ${toolCallId}: expected JSON object arguments`,
    );
  }

  throw new Error(
    `OpenAI-compatible provider returned invalid tool arguments for call ${toolCallId}: expected JSON object arguments`,
  );
}

async function createProviderError(response: Response): Promise<string> {
  const body = (await response.text()).trim();
  const statusText = response.statusText ? ` ${response.statusText}` : "";
  const detail = body ? ` - ${body}` : "";

  return `OpenAI-compatible provider request failed: ${response.status}${statusText}${detail}`;
}
