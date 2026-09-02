import type { AgentStopReason } from "@story-forge/shared";

export type TurnOutcome = {
  status: "completed" | "stopped" | "error";
  stopReason: AgentStopReason;
  steps: number;
  error?: string;
};
