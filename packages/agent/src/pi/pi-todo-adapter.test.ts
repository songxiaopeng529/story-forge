import type { SessionTask, TurnId } from "@story-forge/shared";
import { describe, expect, it } from "vitest";
import { toSessionTasksFromPiTodoResult } from "./pi-todo-adapter";

describe("PI todo adapter", () => {
  it("flattens phased todo state into stable StoryForge tasks", () => {
    const now = new Date("2026-08-07T08:00:00.000Z");
    const first = convert([], "sf_turn_first", now);
    expect(first).toMatchObject([
      {
        title: "Inspect runtime",
        status: "completed",
        activeForm: "Research",
      },
      {
        title: "Replace extension",
        status: "in_progress",
        activeForm: "Replacing the Plan extension",
      },
      {
        title: "Remove legacy flow",
        status: "cancelled",
        activeForm: "Implementation",
      },
    ]);

    const resumed = convert(first, "sf_turn_second", new Date("2026-08-07T09:00:00.000Z"));
    expect(resumed.map((task) => task.id)).toEqual(first.map((task) => task.id));
    expect(resumed[0]?.createdAt).toBe(first[0]?.createdAt);
    expect(resumed[0]?.updatedTurnId).toBe("sf_turn_second");
  });

  it("ignores malformed todo results", () => {
    expect(toSessionTasksFromPiTodoResult({
      result: { details: { state: { phases: [{ name: "Bad", tasks: [{}] }] } } },
      previousTasks: [],
      turnId: "sf_turn_test",
      now: new Date(),
    })).toBeUndefined();
  });
});

function convert(previousTasks: SessionTask[], turnId: TurnId, now: Date): SessionTask[] {
  const tasks = toSessionTasksFromPiTodoResult({
    result: {
      details: {
        action: "transition",
        state: {
          phases: [
            {
              name: "Research",
              tasks: [{
                name: "Inspect runtime",
                description: "Read the current integration.",
                status: "completed",
              }],
            },
            {
              name: "Implementation",
              tasks: [
                {
                  name: "Replace extension",
                  description: "Load the PI todo package.",
                  status: "in_progress",
                },
                {
                  name: "Remove legacy flow",
                  description: "Remove the old mode UI.",
                  status: "cancelled",
                },
              ],
            },
          ],
          workingOn: "Replacing the Plan extension",
        },
      },
    },
    previousTasks,
    turnId,
    now,
  });
  if (!tasks) {
    throw new Error("Expected todo tasks");
  }
  return tasks;
}
