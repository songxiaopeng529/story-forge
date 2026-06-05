export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  name?: string;
  toolCallId?: string;
};

export type ToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ChatRequest = {
  messages: ChatMessage[];
  tools?: ToolSchema[];
};

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ChatResponse = {
  content: string;
  toolCalls: ToolCall[];
};

export type ModelCapabilities = {
  chat: boolean;
  tools: boolean;
  streaming: boolean;
};

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  readonly capabilities: ModelCapabilities;

  chat(request: ChatRequest): Promise<ChatResponse>;
}
