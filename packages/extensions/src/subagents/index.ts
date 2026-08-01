export type SubagentStatus = "idle" | "running" | "completed" | "stopped" | "error";

export type SubagentDescriptor = {
  id: string;
  title: string;
  status: SubagentStatus;
};
