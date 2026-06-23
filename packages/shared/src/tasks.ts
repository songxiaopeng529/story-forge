import type { TurnId } from "./events";

export type TaskId = `sf_task_${string}`;
export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";
export type TurnMode = "normal" | "plan";

export type SessionTask = {
  id: TaskId;
  title: string;
  description?: string | undefined;
  activeForm?: string | undefined;
  status: TaskStatus;
  blockedReason?: string | undefined;
  createdAt: string;
  updatedAt: string;
  createdTurnId?: TurnId | undefined;
  updatedTurnId?: TurnId | undefined;
};

export function createTaskId(): TaskId {
  const entropy = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `sf_task_${entropy}`;
}
