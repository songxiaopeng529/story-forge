import type { ModelProvider } from "@story-forge/model-gateway";
import { createSessionId, createTurnId, type AgentEvent } from "@story-forge/shared";
import type { ToolRegistry } from "@story-forge/tools";
import type { AgentRuntime } from "./agent-runtime";
import { ContextManager } from "./context-manager";

export type NativeAgentRuntimeOptions = {
  provider: ModelProvider;
  tools: ToolRegistry;
  workspaceRoot: string;
  contextManager?: ContextManager;
};

export class NativeAgentRuntime implements AgentRuntime {
  private readonly provider: ModelProvider;
  private readonly tools: ToolRegistry;
  private readonly workspaceRoot: string;
  private readonly contextManager: ContextManager;

  constructor(options: NativeAgentRuntimeOptions) {
    this.provider = options.provider;
    this.tools = options.tools;
    this.workspaceRoot = options.workspaceRoot;
    this.contextManager = options.contextManager ?? new ContextManager();
  }

  async *runTurn(userInput: string): AsyncIterable<AgentEvent> {
    const sessionId = createSessionId();
    const turnId = createTurnId();
    yield { type: "runtime.started", sessionId, turnId, createdAt: new Date().toISOString() };

    try {
      const response = await this.provider.chat({
        messages: this.contextManager.buildMessages({ userInput, workspaceRoot: this.workspaceRoot }),
        tools: this.tools.schemas(),
      });

      for (const toolCall of response.toolCalls) {
        yield {
          type: "tool.call",
          sessionId,
          turnId,
          callId: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        };

        const result = await this.tools.execute(toolCall.name, toolCall.input);
        yield {
          type: "tool.result",
          sessionId,
          turnId,
          callId: toolCall.id,
          name: toolCall.name,
          ok: result.ok,
          output: result.ok ? result.output : result.error,
        };
      }

      if (response.content.length > 0) {
        yield { type: "message.delta", sessionId, turnId, content: response.content };
      }

      yield { type: "runtime.completed", sessionId, turnId };
    } catch (error) {
      yield {
        type: "runtime.error",
        sessionId,
        turnId,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
