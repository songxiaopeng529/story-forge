export type ToolParameters = Record<string, unknown>;

export type ToolExecutionContext = {
  signal?: AbortSignal;
};

export type ToolDefinition<
  Input extends Record<string, unknown> = Record<string, unknown>,
  Output = unknown,
> = {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (input: Input, context: ToolExecutionContext) => Output | Promise<Output>;
};
