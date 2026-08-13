// @vitest-environment node

import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type PersistedMessage,
  SessionRepository,
  type SessionPiAdapter,
} from "../persistence/session-repository";

describe("SessionRepository", () => {
  it("persists multiple independent sessions for the same workspace", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const piMessages = new Map<string, PersistedMessage[]>();
    const repository = new SessionRepository({
      rootDir,
      piAdapter: createFakePiAdapter(piMessages),
    });

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
    piMessages.set(first.id, [{
      id: "message-1",
      role: "user",
      content: "First session",
      createdAt: "2026-06-07T00:00:00.000Z",
    }]);

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

  it("recovers running metadata without materializing PI messages", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const repository = new SessionRepository({ rootDir });
    const session = await repository.create({
      workspaceId: "sf_workspace_removed",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
    });
    await repository.markStatus(session.id, {
      status: "running",
      turnId: "sf_turn_active",
    });
    const failingRepository = new SessionRepository({
      rootDir,
      piAdapter: createFailingLoadAdapter(),
    });

    await expect(failingRepository.recoverInterruptedSessions()).resolves.toBeUndefined();
    await expect(repository.get(session.id)).resolves.toMatchObject({
      status: "interrupted",
      stopReason: "application-restarted",
    });
  });

  it("isolates message materialization failures while listing sessions", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const repository = new SessionRepository({ rootDir });
    const session = await repository.create({
      workspaceId: "sf_workspace_removed",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
    });
    const failingRepository = new SessionRepository({
      rootDir,
      piAdapter: createFailingLoadAdapter(),
    });

    await expect(failingRepository.list()).resolves.toEqual([
      expect.objectContaining({
        id: session.id,
        status: "error",
        stopReason: "session-materialization-failed",
        migrationError: "Transcript unavailable",
        messages: [],
      }),
    ]);
  });

  it("preserves a corrupt session file for recovery", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const sessionsDir = join(rootDir, "sessions", "metadata");
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
    const sessionsDir = join(rootDir, "sessions", "metadata");
    const corruptPath = join(sessionsDir, "sf_session_corrupt.json");
    await writeFile(corruptPath, "{broken", "utf8");

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ id: healthy.id }),
    ]);
    expect(
      (await readdir(sessionsDir)).some((name) =>
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

  it("serializes concurrent metadata updates so titles and tasks are not lost", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const repository = new SessionRepository({ rootDir });
    const session = await repository.create({
      workspaceId: "sf_workspace_project",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
    });

    await Promise.all([
      repository.rename(session.id, "Renamed session"),
      repository.createTask(session.id, {
        title: "Concurrent task",
      }),
    ]);

    expect(await repository.get(session.id)).toMatchObject({
      title: "Renamed session",
      tasks: [
        expect.objectContaining({
          title: "Concurrent task",
        }),
      ],
    });
  });

  it("updates the model for every session without changing any other session data", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const piMessages = new Map<string, PersistedMessage[]>();
    const repository = new SessionRepository({
      rootDir,
      piAdapter: createFakePiAdapter(piMessages),
    });
    const first = await repository.create({
      workspaceId: "sf_workspace_first",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      title: "First workspace session",
    });
    const second = await repository.create({
      workspaceId: "sf_workspace_second",
      providerId: "openai",
      model: "gpt-old",
      title: "Second workspace session",
    });
    await repository.createTask(first.id, {
      title: "Preserve this task",
      description: "The bulk model update must not rewrite task state.",
    });
    piMessages.set(first.id, [{
      id: "message-first",
      role: "user",
      content: "Keep the first transcript",
      createdAt: "2026-08-12T01:00:00.000Z",
    }]);
    piMessages.set(second.id, [{
      id: "message-second",
      role: "assistant",
      content: "Keep the second transcript",
      createdAt: "2026-08-12T02:00:00.000Z",
    }]);
    const beforeFirst = await repository.get(first.id);
    const beforeSecond = await repository.get(second.id);

    await repository.updateModelForAllSessions({
      providerId: "anthropic",
      model: "claude-sonnet-test",
    });

    await expect(repository.get(first.id)).resolves.toEqual({
      ...beforeFirst,
      providerId: "anthropic",
      model: "claude-sonnet-test",
    });
    await expect(repository.get(second.id)).resolves.toEqual({
      ...beforeSecond,
      providerId: "anthropic",
      model: "claude-sonnet-test",
    });

    await repository.attachPiSession(first.id, {
      piSessionId: "pi_rebound",
      piSessionFile: "/tmp/rebound.jsonl",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
    });
    await expect(repository.get(first.id)).resolves.toMatchObject({
      providerId: "anthropic",
      model: "claude-sonnet-test",
      piSessionId: "pi_rebound",
      piSessionFile: "/tmp/rebound.jsonl",
    });
  });

  it("serializes consecutive model updates so the latest selection wins", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-session-"));
    const repository = new SessionRepository({ rootDir });
    const session = await repository.create({
      workspaceId: "sf_workspace_project",
      providerId: "openai",
      model: "gpt-b",
    });

    const first = repository.updateModelForAllSessions({
      providerId: "anthropic",
      model: "claude-a",
    });
    const second = repository.updateModelForAllSessions({
      providerId: "openai",
      model: "gpt-b",
    });
    await Promise.all([first, second]);

    await expect(repository.get(session.id)).resolves.toMatchObject({
      providerId: "openai",
      model: "gpt-b",
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

function createFakePiAdapter(
  messages: Map<string, PersistedMessage[]> = new Map(),
): SessionPiAdapter {
  return {
    async createPiSession(input) {
      return {
        piSessionId: `pi_${input.sessionId}`,
        piSessionFile: `/tmp/${input.sessionId}.jsonl`,
      };
    },
    async migrateLegacySession(session) {
      messages.set(session.id, session.messages);
      return {
        piSessionId: `pi_${session.id}`,
        piSessionFile: `/tmp/${session.id}.jsonl`,
      };
    },
    async loadMessages(session) {
      return messages.get(session.id) ?? [];
    },
    async deletePiSession() {},
  };
}

function createFailingLoadAdapter(): SessionPiAdapter {
  return {
    async createPiSession(input) {
      return {
        piSessionId: `pi_${input.sessionId}`,
        piSessionFile: `/tmp/${input.sessionId}.jsonl`,
      };
    },
    async migrateLegacySession() {
      throw new Error("unused");
    },
    async loadMessages() {
      throw new Error("Transcript unavailable");
    },
    async deletePiSession() {},
  };
}
