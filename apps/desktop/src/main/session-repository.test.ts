// @vitest-environment node

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
});
