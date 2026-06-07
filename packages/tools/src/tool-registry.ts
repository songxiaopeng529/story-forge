export type ToolParameters = Record<string, unknown>;

export type ToolExecutionContext = {
  signal?: AbortSignal;
};

export type ToolDefinition<Input extends Record<string, unknown> = Record<string, unknown>, Output = unknown> = {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (input: Input, context: ToolExecutionContext) => Output | Promise<Output>;
};

export type ToolSchema = Pick<ToolDefinition, "name" | "description" | "parameters">;

export type ToolExecutionResult =
  | {
      ok: true;
      output: unknown;
    }
  | {
      ok: false;
      error: string;
    };

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(definitions: ToolDefinition[] = []) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  register(definition: ToolDefinition): void {
    this.tools.set(definition.name, definition);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  schemas(): ToolSchema[] {
    return this.list().map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext = {},
  ): Promise<ToolExecutionResult> {
    const definition = this.tools.get(name);
    if (!definition) {
      return { ok: false, error: `Tool not found: ${name}` };
    }

    try {
      const output = await definition.execute(input, context);
      return { ok: true, output };
    } catch (error) {
      return { ok: false, error: formatToolError(error) };
    }
  }
}

function formatToolError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
