import {
  SOUL_MAX_BYTES,
  type SoulDocumentView,
} from "@story-forge/shared";
import type { ToolDefinition, ToolExecutionContext } from "../tool-definition";

export const SOUL_UPDATE_TOOL_NAME = "soul_propose_update";

export type SoulUpdateProposal = {
  content: string;
  reason: string;
};

export type SoulUpdateDecision = {
  approved: boolean;
  document?: SoulDocumentView;
  message: string;
};

export function createSoulUpdateTool(options: {
  propose: (
    proposal: SoulUpdateProposal,
    context: ToolExecutionContext,
  ) => Promise<SoulUpdateDecision>;
}): ToolDefinition<Record<string, unknown>, SoulUpdateDecision> {
  return {
    name: SOUL_UPDATE_TOOL_NAME,
    description:
      "Propose a complete, concise update to the user's global soul.md profile. Use only for durable user facts or preferences that will improve future conversations; never store secrets, credentials, temporary requests, project facts, or sensitive inferred attributes.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["content", "reason"],
      properties: {
        content: {
          type: "string",
          description:
            "The complete proposed soul.md Markdown content. Preserve useful existing memories and keep the document concise.",
        },
        reason: {
          type: "string",
          description: "A short user-facing explanation of what should be remembered and why.",
        },
      },
    },
    execute: async (input, context) => {
      const content = readRequiredString(input.content, "content", false);
      const reason = readRequiredString(input.reason, "reason", true);
      if (new TextEncoder().encode(content).byteLength > SOUL_MAX_BYTES) {
        throw new Error(`soul_propose_update content must not exceed ${SOUL_MAX_BYTES} UTF-8 bytes`);
      }
      return options.propose({ content, reason }, context);
    },
  };
}

function readRequiredString(value: unknown, field: string, trim: boolean): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`soul_propose_update requires a non-empty string ${field}`);
  }
  return trim ? value.trim() : value;
}
