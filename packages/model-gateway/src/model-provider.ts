export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type SystemChatMessage = {
  role: "system";
  content: string;
};

export type UserChatMessage = {
  role: "user";
  content: UserChatContent;
};

export type TextContentPart = {
  type: "text";
  text: string;
};

export type ImageContentPart = {
  type: "image";
  mediaType: string;
  data: string;
  filename?: string;
};

export type UserChatContent = string | Array<TextContentPart | ImageContentPart>;

export type AssistantChatMessage = {
  role: "assistant";
  content: string;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
  kind?: "summary";
};

export type ToolChatMessage = {
  role: "tool";
  content: string;
  name: string;
  toolCallId: string;
};

export type ChatMessage =
  | SystemChatMessage
  | UserChatMessage
  | AssistantChatMessage
  | ToolChatMessage;

export type ToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ChatRequest = {
  messages: ChatMessage[];
  tools?: ToolSchema[];
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ChatResponse = {
  content: string;
  reasoningContent?: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
};

export type ChatStreamEvent =
  | { type: "content.delta"; content: string }
  | { type: "reasoning.delta"; content: string }
  | { type: "tool.call"; toolCall: ToolCall }
  | { type: "done"; response: ChatResponse };

export type ChatOptions = {
  signal?: AbortSignal;
};

export type ModelCapabilities = {
  toolCalling: boolean;
  streaming: boolean;
  jsonSchema: boolean;
  contextWindowTokens: number;
};

export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ModelCapabilities;

  chat(request: ChatRequest, options?: ChatOptions): Promise<ChatResponse>;
  streamChat?(request: ChatRequest, options?: ChatOptions): AsyncIterable<ChatStreamEvent>;
}
