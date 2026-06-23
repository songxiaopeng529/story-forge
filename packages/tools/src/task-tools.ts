import type { ToolDefinition } from "./tool-registry";

export type TaskId = `sf_task_${string}`;
export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";
export type TurnId = `sf_turn_${string}`;

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

export type TaskToolMutationResult = {
  task: SessionTask;
  tasks: SessionTask[];
};

export type TaskToolStore = {
  listTasks(): Promise<SessionTask[]> | SessionTask[];
  createTask(input: {
    title: string;
    description?: string;
    activeForm?: string;
    turnId?: TurnId;
  }): Promise<TaskToolMutationResult> | TaskToolMutationResult;
  updateTask(input: {
    taskId: TaskId;
    title?: string;
    description?: string;
    activeForm?: string;
    status?: TaskStatus;
    blockedReason?: string;
    turnId?: TurnId;
  }): Promise<TaskToolMutationResult> | TaskToolMutationResult;
};

export function createTaskTools(options: {
  store: TaskToolStore;
  turnId?: TurnId;
}): ToolDefinition[] {
  return [
    {
      name: "task.create",
      description: "Create a task in the current StoryForge task list.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short task title." },
          description: { type: "string", description: "Optional implementation detail." },
          activeForm: { type: "string", description: "Optional text shown while the task is active." },
        },
        required: ["title"],
      },
      execute: async (input) => {
        return options.store.createTask({
          ...readCreateInput(input),
          ...(options.turnId ? { turnId: options.turnId } : {}),
        });
      },
    },
    {
      name: "task.update",
      description: "Update status or details for an existing StoryForge task.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task id returned by task.create or task.list." },
          title: { type: "string" },
          description: { type: "string" },
          activeForm: { type: "string" },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "blocked"],
          },
          blockedReason: { type: "string" },
        },
        required: ["taskId"],
      },
      execute: async (input) => {
        return options.store.updateTask({
          ...readUpdateInput(input),
          ...(options.turnId ? { turnId: options.turnId } : {}),
        });
      },
    },
    {
      name: "task.list",
      description: "Return the current StoryForge task list.",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async () => ({ tasks: await options.store.listTasks() }),
    },
  ];
}

function readCreateInput(input: Record<string, unknown>): {
  title: string;
  description?: string;
  activeForm?: string;
} {
  return {
    title: readRequiredString(input.title, "task.create", "title"),
    ...readOptionalStringField(input.description, "task.create", "description"),
    ...readOptionalStringField(input.activeForm, "task.create", "activeForm"),
  };
}

function readUpdateInput(input: Record<string, unknown>): {
  taskId: TaskId;
  title?: string;
  description?: string;
  activeForm?: string;
  status?: TaskStatus;
  blockedReason?: string;
} {
  const status = readOptionalStatus(input.status);
  const blockedReason = readOptionalString(input.blockedReason, "task.update", "blockedReason");
  if (status === "blocked" && !blockedReason) {
    throw new Error("task.update requires blockedReason when status is blocked");
  }
  return {
    taskId: readTaskId(input.taskId),
    ...readOptionalStringField(input.title, "task.update", "title"),
    ...readOptionalStringField(input.description, "task.update", "description"),
    ...readOptionalStringField(input.activeForm, "task.update", "activeForm"),
    ...(status ? { status } : {}),
    ...(blockedReason ? { blockedReason } : {}),
  };
}

function readTaskId(value: unknown): TaskId {
  const taskId = readRequiredString(value, "task.update", "taskId");
  if (!/^sf_task_[a-z0-9]+$/.test(taskId)) {
    throw new Error("task.update requires a valid taskId");
  }
  return taskId as TaskId;
}

function readOptionalStatus(value: unknown): TaskStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "pending" || value === "in_progress" || value === "completed" || value === "blocked") {
    return value;
  }
  throw new Error("task.update status must be pending, in_progress, completed, or blocked");
}

function readOptionalStringField(
  value: unknown,
  toolName: string,
  field: string,
): Record<string, string> {
  const parsed = readOptionalString(value, toolName, field);
  return parsed ? { [field]: parsed } : {};
}

function readRequiredString(value: unknown, toolName: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${toolName} requires a non-empty string ${field}`);
  }
  return value.trim();
}

function readOptionalString(
  value: unknown,
  toolName: string,
  field: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${toolName} requires string ${field}`);
  }
  return value.trim() || undefined;
}
