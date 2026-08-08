// @vitest-environment node

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SessionMetadataRecord } from "../persistence/session-repository";
import { PiSessionAdapter } from "./pi-session-adapter";

describe("PiSessionAdapter", () => {
  it("loads transcript messages without requiring a registered workspace", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-pi-adapter-"));
    const sessionDir = join(rootDir, "sessions", "transcripts", "sf_workspace_removed");
    await mkdir(sessionDir, { recursive: true });
    const manager = SessionManager.create("/tmp/removed-workspace", sessionDir, {
      id: "sf_session_orphan",
    });
    manager.appendMessage({
      role: "user",
      content: "Preserved message",
      timestamp: Date.now(),
    });
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Preserved response" }],
      api: "openai-responses",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    const getWorkspace = vi.fn(async () => {
      throw new Error("Workspace not found");
    });
    const adapter = new PiSessionAdapter({
      rootDir,
      workspaces: { get: getWorkspace },
      piModels: {} as never,
    });
    const session = {
      schemaVersion: 2,
      id: "sf_session_orphan",
      workspaceId: "sf_workspace_removed",
      title: "Orphan session",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      status: "completed",
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
      tasks: [],
      piSessionId: manager.getSessionId(),
      piSessionFile: manager.getSessionFile(),
      migrationStatus: "ok",
    } satisfies SessionMetadataRecord;

    await expect(adapter.loadMessages(session)).resolves.toEqual([
      expect.objectContaining({ role: "user", content: "Preserved message" }),
      expect.objectContaining({ role: "assistant", content: "Preserved response" }),
    ]);
    expect(getWorkspace).not.toHaveBeenCalled();
  });

  it("materializes a provider error as visible assistant content", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "story-forge-pi-error-"));
    const sessionDir = join(rootDir, "sessions", "transcripts", "sf_workspace_error");
    await mkdir(sessionDir, { recursive: true });
    const manager = SessionManager.create("/tmp/error-workspace", sessionDir, {
      id: "sf_session_error",
    });
    manager.appendMessage({
      role: "assistant",
      content: [],
      api: "anthropic-messages",
      provider: "kimi-coding",
      model: "k3",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      errorMessage: "400 invalid tool name",
      timestamp: Date.now(),
    });
    const adapter = new PiSessionAdapter({
      rootDir,
      workspaces: { get: vi.fn() },
      piModels: {} as never,
    });
    const session = {
      schemaVersion: 2,
      id: "sf_session_error",
      workspaceId: "sf_workspace_error",
      title: "Provider error",
      providerId: "kimi-coding",
      model: "k3",
      status: "error",
      stopReason: "unrecoverable-error",
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
      tasks: [],
      piSessionId: manager.getSessionId(),
      piSessionFile: manager.getSessionFile(),
      migrationStatus: "ok",
    } satisfies SessionMetadataRecord;

    await expect(adapter.loadMessages(session)).resolves.toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "400 invalid tool name",
        error: true,
      }),
    ]);
  });
});
