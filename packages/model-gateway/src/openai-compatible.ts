import type { ChatMessage, ChatRequest, ChatResponse, ModelCapabilities, ModelProvider, ToolSchema } from "./model-provider";

type FetchFunction = (input: string, init: RequestInit) => Promise<Response>;

export type OpenAICompatibleProviderOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetch?: FetchFunction;
  name?: string;
  capabilities?: Partial<ModelCapabilities>;
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
      tool_calls?: OpenAICompatibleToolCall[];
    };
  }>;
};

export class OpenAICompatibleProvider implements ModelProvider {
  readonly name: string;
  readonly model: string;
  readonly capabilities: ModelCapabilities;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetch: FetchFunction;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.model = options.model;
    this.name = options.name ?? "openai-compatible";
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.capabilities = {
      chat: options.capabilities?.chat ?? true,
      tools: options.capabilities?.tools ?? true,
      streaming: options.capabilities?.streaming ?? false,
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages.map(toOpenAICompatibleMessage),
        ...(request.tools ? { tools: request.tools.map(toOpenAICompatibleTool) } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(await createProviderError(response));
    }

    const completion = (await response.json()) as OpenAICompatibleChatCompletion;
    const message = completion.choices?.[0]?.message;

    return {
      content: message?.content ?? "",
      toolCalls:
        message?.tool_calls?.map((toolCall) => ({
          id: toolCall.id ?? "",
          name: toolCall.function?.name ?? "",
          input: parseToolArguments(toolCall.function?.arguments),
        })) ?? [],
    };
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function toOpenAICompatibleMessage(message: ChatMessage): Record<string, string> {
  return {
    role: message.role,
    content: message.content,
    ...(message.name ? { name: message.name } : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
  };
}

function toOpenAICompatibleTool(tool: ToolSchema): OpenAICompatibleTool {
  return {
    type: "function",
    function: tool,
  };
}

function parseToolArguments(argumentsText: string | undefined): Record<string, unknown> {
  if (!argumentsText) {
    return {};
  }

  try {
    const parsed = JSON.parse(argumentsText) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

async function createProviderError(response: Response): Promise<string> {
  const body = (await response.text()).trim();
  const statusText = response.statusText ? ` ${response.statusText}` : "";
  const detail = body ? ` - ${body}` : "";

  return `OpenAI-compatible provider request failed: ${response.status}${statusText}${detail}`;
}
