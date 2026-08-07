import { createHash } from "node:crypto";
import { toRecord, type SessionTask, type TaskId, type TurnId } from "@story-forge/shared";

type PiTodoSnapshot = {
  phases: Array<{
    name: string;
    tasks: Array<{
      name: string;
      description: string;
      status: "pending" | "in_progress" | "completed" | "cancelled";
    }>;
  }>;
  workingOn?: string;
};

export function toSessionTasksFromPiTodoResult(input: {
  result: unknown;
  previousTasks: SessionTask[];
  turnId: TurnId;
  now: Date;
}): SessionTask[] | undefined {
  const snapshot = readTodoSnapshot(input.result);
  if (!snapshot) {
    return undefined;
  }
  const updatedAt = input.now.toISOString();
  const previousById = new Map(input.previousTasks.map((task) => [task.id, task]));
  return snapshot.phases.flatMap((phase) => phase.tasks.map((task) => {
    const id = todoTaskId(phase.name, task.name);
    const previous = previousById.get(id);
    const activeForm = task.status === "in_progress"
      ? snapshot.workingOn ?? phase.name
      : phase.name;
    return {
      id,
      title: task.name,
      description: task.description,
      activeForm,
      status: task.status,
      createdAt: previous?.createdAt ?? updatedAt,
      updatedAt,
      createdTurnId: previous?.createdTurnId ?? input.turnId,
      updatedTurnId: input.turnId,
    };
  }));
}

function readTodoSnapshot(result: unknown): PiTodoSnapshot | undefined {
  const stateRecord = toRecord(toRecord(toRecord(result).details).state);
  if (!Array.isArray(stateRecord.phases)) {
    return undefined;
  }
  const phases = stateRecord.phases.map((phaseValue) => {
    const phase = toRecord(phaseValue);
    if (typeof phase.name !== "string" || !Array.isArray(phase.tasks)) {
      return undefined;
    }
    const tasks = phase.tasks.map((taskValue) => {
      const task = toRecord(taskValue);
      if (
        typeof task.name !== "string"
        || typeof task.description !== "string"
        || !isPiTodoStatus(task.status)
      ) {
        return undefined;
      }
      return {
        name: task.name,
        description: task.description,
        status: task.status,
      };
    });
    if (tasks.some((task) => task === undefined)) {
      return undefined;
    }
    return { name: phase.name, tasks: tasks.filter(isDefined) };
  });
  if (phases.some((phase) => phase === undefined)) {
    return undefined;
  }
  const workingOn = typeof stateRecord.workingOn === "string"
    ? stateRecord.workingOn
    : undefined;
  return {
    phases: phases.filter(isDefined),
    ...(workingOn ? { workingOn } : {}),
  };
}

function todoTaskId(phase: string, task: string): TaskId {
  const digest = createHash("sha256")
    .update(phase)
    .update("\0")
    .update(task)
    .digest("hex")
    .slice(0, 20);
  return `sf_task_todo${digest}`;
}

function isPiTodoStatus(
  value: unknown,
): value is PiTodoSnapshot["phases"][number]["tasks"][number]["status"] {
  return value === "pending"
    || value === "in_progress"
    || value === "completed"
    || value === "cancelled";
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
