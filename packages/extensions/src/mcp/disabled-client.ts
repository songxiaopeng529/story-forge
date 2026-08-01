export type McpToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export interface McpClient {
  listTools(): Promise<McpToolDescriptor[]>;
}

export class DisabledMcpClient implements McpClient {
  async listTools(): Promise<McpToolDescriptor[]> {
    return [];
  }
}
