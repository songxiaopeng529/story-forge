import { describe, expect, it } from "vitest";
import {
  createTaskTools,
  type SessionTask,
  type TaskId,
  type TaskStatus,
  type TaskToolStore,
  type TurnId,
} from "./task-tools";

describe("createTaskTools", () => {
  it("creates a task and returns the changed task plus the full snapshot", async () => {
    const store = createMemoryTaskStore();
    const registry = Object.fromEntries(createTaskTools({ store }).map((tool) => [tool.name, tool]));

    const output = await registry["task.create"]?.execute({
      title: " Inspect runtime ",
      description: " Read files ",
      activeForm: " Inspecting ",
    }, {});

    expect(output).toMatchObject({
      task: {
        id: "sf_task_1",
        title: "Inspect runtime",
        description: "Read files",
        activeForm: "Inspecting",
        status: "pending",
      },
      tasks: [
        expect.objectContaining({
          id: "sf_task_1",
          title: "Inspect runtime",
        }),
      ],
    });
  });

  it("updates a task and enforces a reason for blocked tasks", async () => {
    const store = createMemoryTaskStore();
    const registry = Object.fromEntries(createTaskTools({ store }).map((tool) => [tool.name, tool]));
    await registry["task.create"]?.execute({ title: "Inspect runtime" }, {});

    await expect(
      registry["task.update"]?.execute({
        taskId: "sf_task_1",
        status: "blocked",
      }, {}),
    ).rejects.toThrow("task.update requires blockedReason when status is blocked");

    const output = await registry["task.update"]?.execute({
      taskId: "sf_task_1",
      status: "blocked",
      blockedReason: "Need approval",
    }, {});

    expect(output).toMatchObject({
      task: {
        id: "sf_task_1",
        status: "blocked",
        blockedReason: "Need approval",
      },
      tasks: [
        expect.objectContaining({
          id: "sf_task_1",
          status: "blocked",
        }),
      ],
    });
  });

  it("lists current tasks and passes turn ids through mutations", async () => {
    const store = createMemoryTaskStore();
    const registry = Object.fromEntries(
      createTaskTools({ store, turnId: "sf_turn_task" }).map((tool) => [tool.name, tool]),
    );
    await registry["task.create"]?.execute({ title: "First" }, {});
    await registry["task.update"]?.execute({
      taskId: "sf_task_1",
      status: "in_progress",
    }, {});

    const output = await registry["task.list"]?.execute({}, {});

    expect(output).toMatchObject({
      tasks: [
        {
          id: "sf_task_1",
          title: "First",
          status: "in_progress",
          createdTurnId: "sf_turn_task",
          updatedTurnId: "sf_turn_task",
        },
      ],
    });
  });

  it("rejects invalid inputs before calling the store", async () => {
    const store = createMemoryTaskStore();
    const registry = Object.fromEntries(createTaskTools({ store }).map((tool) => [tool.name, tool]));

    await expect(registry["task.create"]?.execute({ title: " " }, {}))
      .rejects.toThrow("task.create requires a non-empty string title");
    await expect(registry["task.update"]?.execute({ taskId: "sf_task_1", status: "started" }, {}))
      .rejects.toThrow("task.update status must be pending, in_progress, completed, or blocked");
  });
});

function createMemoryTaskStore(): TaskToolStore {
  let nextId = 1;
  let tasks: SessionTask[] = [];
  const now = "2026-06-23T00:00:00.000Z";

  return {
    async listTasks() {
      return tasks;
    },
    async createTask(input) {
      const task: SessionTask = {
        id: `sf_task_${nextId++}` as TaskId,
        title: input.title,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        ...(input.description ? { description: input.description } : {}),
        ...(input.activeForm ? { activeForm: input.activeForm } : {}),
        ...(input.turnId ? { createdTurnId: input.turnId, updatedTurnId: input.turnId } : {}),
      };
      tasks = [...tasks, task];
      return { task, tasks };
    },
    async updateTask(input) {
      const task = tasks.find((candidate) => candidate.id === input.taskId);
      if (!task) {
        throw new Error(`Task not found: ${input.taskId}`);
      }
      const updated: SessionTask = {
        ...task,
        ...(input.title ? { title: input.title } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.activeForm ? { activeForm: input.activeForm } : {}),
        ...(input.status ? { status: input.status as TaskStatus } : {}),
        ...(input.blockedReason ? { blockedReason: input.blockedReason } : {}),
        ...(input.turnId ? { updatedTurnId: input.turnId as TurnId } : {}),
        updatedAt: now,
      };
      tasks = tasks.map((candidate) => candidate.id === input.taskId ? updated : candidate);
      return { task: updated, tasks };
    },
  };
}
