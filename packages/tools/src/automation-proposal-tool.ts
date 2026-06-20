import type { ToolDefinition } from "./tool-registry";

export type AutomationProposalDraft = {
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
    name: readString(input.name, "name"),
    scheduleText: readString(input.scheduleText, "scheduleText"),
    cron: readString(input.cron, "cron"),
    timezone: readString(input.timezone, "timezone"),
    prompt: readString(input.prompt, "prompt"),
  };
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`automation.proposeCreate requires a non-empty string ${field}`);
  }
  return value.trim();
}
