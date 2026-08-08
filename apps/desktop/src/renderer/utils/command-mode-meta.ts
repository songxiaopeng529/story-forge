import type { CommandExecutionMode } from "@story-forge/shared";

export const commandModeMeta: Record<
  CommandExecutionMode,
  { label: string; chip: string; approval: string; description: string }
> = {
  sentinel: {
    label: "Command mode",
    chip: "Sentry mode",
    approval: "risky asks",
    description: "Sentry mode asks before unknown, high-risk, destructive, or elevated commands.",
  },
  cruise: {
    label: "Command mode",
    chip: "Cruise mode",
    approval: "risky asks",
    description: "Cruise mode runs ordinary commands and asks before high-risk operations.",
  },
  unleashed: {
    label: "Command mode",
    chip: "Unleashed mode",
    approval: "never asks",
    description: "Unleashed mode runs every command as your current system user without confirmation.",
  },
};
