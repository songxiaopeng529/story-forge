import type { ToolDefinition } from "./tool-registry";

export type AutomationProposalKind = "scheduled_chat" | "thread_chat";

export type AutomationProposalDraft = {
  kind: AutomationProposalKind;
  name: string;
  scheduleText: string;
  cron: string;
  timezone: string;
  prompt: string;
};

export type AutomationProposalValidated = AutomationProposalDraft & {
  summary: string;
  nextRuns: string[];
};

export function createAutomationProposalTool(options: {
  validate: (draft: AutomationProposalDraft) => AutomationProposalValidated;
  emit: (proposal: AutomationProposalValidated) => void;
}): ToolDefinition {
  return {
    name: "automation.proposeCreate",
    description:
      "Propose a scheduled automation for the user to review and confirm. This does not create the automation.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        scheduleText: { type: "string" },
        cron: { type: "string" },
        timezone: { type: "string" },
        prompt: { type: "string" },
        kind: {
          type: "string",
          enum: ["scheduled_chat", "thread_chat"],
          description:
            "Use thread_chat only when the user explicitly wants the automation to continue in the current chat session. Otherwise use scheduled_chat.",
        },
        sessionId: {
          type: "string",
          description:
            "Ignored by StoryForge. Thread timers are always bound to the current chat session by the app.",
        },
      },
      required: ["name", "scheduleText", "cron", "timezone", "prompt"],
    },
    execute: async (input) => {
      const draft = readProposalDraft(input);
      const proposal = options.validate(draft);
      options.emit(proposal);
      return {
        proposed: true,
        message: "Automation proposal is ready for user confirmation.",
      };
    },
  };
}

function readProposalDraft(input: Record<string, unknown>): AutomationProposalDraft {
  return {
    kind: readKind(input.kind),
    name: readString(input.name, "name"),
    scheduleText: readString(input.scheduleText, "scheduleText"),
    cron: readString(input.cron, "cron"),
    timezone: readString(input.timezone, "timezone"),
    prompt: readString(input.prompt, "prompt"),
  };
}

function readKind(value: unknown): AutomationProposalKind {
  if (value === undefined) {
    return "scheduled_chat";
  }
  if (value === "scheduled_chat" || value === "thread_chat") {
    return value;
  }
  throw new Error("automation.proposeCreate kind must be scheduled_chat or thread_chat");
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`automation.proposeCreate requires a non-empty string ${field}`);
  }
  return value.trim();
}
