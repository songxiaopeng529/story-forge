import {
  defineTool,
  type ToolDefinition as PiToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ToolDefinition as StoryForgeToolDefinition } from "@story-forge/extensions";

/**
 * Adapt StoryForge's dependency-light tool contract to PI's tool definition.
 *
 * Keeping this adapter outside the root harness lets root and child workers use
 * the same execution and cancellation semantics without sharing tool policy.
 */
export function toPiToolDefinition(
  tool: StoryForgeToolDefinition,
): PiToolDefinition {
  return defineTool({
    name: tool.name,
    label: tool.name,
    description: tool.description,
    promptSnippet: tool.description,
    parameters: tool.parameters as never,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      const output = await tool.execute(
        params as Record<string, unknown>,
        signal ? { signal } : {},
      );
      return {
        content: [{ type: "text", text: formatStoryForgeToolOutput(output) }],
        details: output,
      };
    },
  });
}

export function formatStoryForgeToolOutput(output: unknown): string {
  return typeof output === "string" ? output : JSON.stringify(output, null, 2);
}
