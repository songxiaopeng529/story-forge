// @vitest-environment node

import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionRepository } from "./session-repository";

describe("SessionRepository", () => {
  it("persists multiple independent sessions for the same workspace", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const repository = new SessionRepository({ rootDir });

    const first = await repository.create({
      workspaceId: "sf_workspace_project",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
    });
    const second = await repository.create({
      workspaceId: "sf_workspace_project",
      providerId: "openai",
      model: "gpt-test",
    });
    await repository.appendMessage(first.id, {
      id: "message-1",
      role: "user",
      content: "First session",
      createdAt: "2026-06-07T00:00:00.000Z",
    });

    expect(await repository.list("sf_workspace_project")).toHaveLength(2);
    expect((await repository.get(first.id)).messages).toHaveLength(1);
    expect((await repository.get(second.id)).messages).toHaveLength(0);
  });

  it("marks running sessions as interrupted during startup recovery", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const repository = new SessionRepository({ rootDir });
    const session = await repository.create({
      workspaceId: "sf_workspace_project",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
    });
    await repository.markStatus(session.id, {
      status: "running",
      turnId: "sf_turn_active",
    });

    await repository.recoverInterruptedSessions();

    expect(await repository.get(session.id)).toMatchObject({
      status: "interrupted",
      stopReason: "application-restarted",
    });
  });

  it("preserves a corrupt session file for recovery", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const sessionsDir = join(rootDir, "sessions");
    const repository = new SessionRepository({ rootDir });
    const session = await repository.create({
      workspaceId: "sf_workspace_project",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
    });
    const sessionPath = join(sessionsDir, `${session.id}.json`);
    await writeFile(sessionPath, "{not valid json", "utf8");

    await expect(repository.get(session.id)).rejects.toThrow("Session file is corrupt");
    const directory = await import("node:fs/promises").then(({ readdir }) => readdir(sessionsDir));
    expect(directory.some((name) => name.startsWith(`${session.id}.json.corrupt-`))).toBe(true);
    await expect(readFile(sessionPath, "utf8")).rejects.toThrow();
  });

  it("quarantines corrupt files without blocking healthy session listing", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const repository = new SessionRepository({ rootDir });
    const healthy = await repository.create({
      workspaceId: "sf_workspace_project",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
    });
    const corruptPath = join(rootDir, "sessions", "sf_session_corrupt.json");
    await writeFile(corruptPath, "{broken", "utf8");

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ id: healthy.id }),
    ]);
    expect(
      (await readdir(join(rootDir, "sessions"))).some((name) =>
        name.startsWith("sf_session_corrupt.json.corrupt-")
      ),
    ).toBe(true);
  });

  it("rejects malformed session ids before resolving a filesystem path", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const repository = new SessionRepository({ rootDir });

    await expect(
      repository.get("sf_session_../../providers" as never),
    ).rejects.toThrow("Invalid session id");
    await expect(
      repository.delete("sf_session_../../providers" as never),
    ).rejects.toThrow("Invalid session id");
  });

  it("serializes concurrent updates so titles and messages are not lost", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const repository = new SessionRepository({ rootDir });
    const session = await repository.create({
      workspaceId: "sf_workspace_project",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
    });

    await Promise.all([
      repository.rename(session.id, "Renamed session"),
      repository.appendMessage(session.id, {
        id: "message-concurrent",
        role: "user",
        content: "Concurrent message",
        createdAt: "2026-06-07T00:00:00.000Z",
      }),
    ]);

    expect(await repository.get(session.id)).toMatchObject({
      title: "Renamed session",
      messages: [
        expect.objectContaining({
          id: "message-concurrent",
          content: "Concurrent message",
        }),
      ],
    });
  });

  it("defaults missing tasks to an empty list", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const repository = new SessionRepository({ rootDir });
    const session = await repository.create({
      workspaceId: "sf_workspace_project",
      providerId: "openai",
      model: "gpt-test",
    });

    await expect(repository.listTasks(session.id)).resolves.toEqual([]);
    expect((await repository.get(session.id)).tasks).toEqual([]);
  });

  it("creates and updates tasks on the session", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const repository = new SessionRepository({ rootDir });
    const session = await repository.create({
      workspaceId: "sf_workspace_project",
      providerId: "openai",
      model: "gpt-test",
    });

    const afterCreate = await repository.createTask(session.id, {
      title: "Inspect runtime",
      description: "Read the runtime files.",
      activeForm: "Inspecting runtime files",
      turnId: "sf_turn_task",
    });
    const task = afterCreate.tasks[0]!;

    expect(task).toMatchObject({
      title: "Inspect runtime",
      description: "Read the runtime files.",
      activeForm: "Inspecting runtime files",
      status: "pending",
      createdTurnId: "sf_turn_task",
      updatedTurnId: "sf_turn_task",
    });

    const afterUpdate = await repository.updateTask(session.id, {
      taskId: task.id,
      status: "blocked",
      blockedReason: "Need approval",
      turnId: "sf_turn_task2",
    });

    expect(afterUpdate.tasks[0]).toMatchObject({
      status: "blocked",
      blockedReason: "Need approval",
      updatedTurnId: "sf_turn_task2",
    });
  });

  it("keeps only one task in progress", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const repository = new SessionRepository({ rootDir });
    const session = await repository.create({
      workspaceId: "sf_workspace_project",
      providerId: "openai",
      model: "gpt-test",
    });

    const first = (await repository.createTask(session.id, { title: "First" })).tasks[0]!;
    const second = (await repository.createTask(session.id, { title: "Second" })).tasks[1]!;

    await repository.updateTask(session.id, {
      taskId: first.id,
      status: "in_progress",
    });
    const updated = await repository.updateTask(session.id, {
      taskId: second.id,
      status: "in_progress",
    });

    expect(updated.tasks.map((task) => [task.title, task.status])).toEqual([
      ["First", "pending"],
      ["Second", "in_progress"],
    ]);
  });
});
