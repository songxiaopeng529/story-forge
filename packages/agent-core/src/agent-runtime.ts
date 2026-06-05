import type { AgentEvent } from "@story-forge/shared";

export interface AgentRuntime {
  runTurn(userInput: string): AsyncIterable<AgentEvent>;
}
