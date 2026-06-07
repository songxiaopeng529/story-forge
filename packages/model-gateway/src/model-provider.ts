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
  content: string;
};

export type AssistantChatMessage = {
  role: "assistant";
  content: string;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
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

export type ChatResponse = {
  content: string;
  reasoningContent?: string;
  toolCalls: ToolCall[];
};

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
}
