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
  toolCalling: boolean;
  streaming: boolean;
  jsonSchema: boolean;
  contextWindowTokens: number;
};

export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ModelCapabilities;

  chat(request: ChatRequest): Promise<ChatResponse>;
}
