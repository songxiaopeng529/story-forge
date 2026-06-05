import type { ChatMessage } from "@story-forge/model-gateway";

export type ContextManagerInput = {
  userInput: string;
  workspaceRoot: string;
};

export class ContextManager {
  buildMessages(input: ContextManagerInput): ChatMessage[] {
    return [
      {
        role: "system",
        content:
          "You are StoryForge, a local coding agent. Be concise, inspect before editing, and use tools only when they help the task.",
      },
      {
        role: "user",
        content: `Workspace: ${input.workspaceRoot}\n\nTask: ${input.userInput}`,
      },
    ];
  }
}
