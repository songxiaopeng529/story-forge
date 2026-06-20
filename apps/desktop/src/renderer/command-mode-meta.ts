import type { CommandExecutionMode } from "@story-forge/shared";

export const commandModeMeta: Record<
  CommandExecutionMode,
  { label: string; chip: string; approval: string; description: string }
> = {
  sentinel: {
    label: "Command mode",
    chip: "Sentry mode",
    approval: "risky asks",
    description: "Sentry mode allows read-only inspection and asks before risky commands.",
  },
  cruise: {
    label: "Command mode",
    chip: "Cruise mode",
    approval: "destructive asks",
    description: "Cruise mode runs most commands and only asks before destructive operations.",
  },
  unleashed: {
    label: "Command mode",
    chip: "Unleashed mode",
    approval: "never asks",
    description: "Unleashed mode runs every command without confirmation. Use only when trusted.",
  },
};
