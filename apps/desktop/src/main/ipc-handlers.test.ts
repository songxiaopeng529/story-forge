// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../shared/story-forge-api";
import type { AgentCoordinator } from "./agent-coordinator";
import type { AppSettingsStore } from "./app-settings-store";
import { registerIpcHandlers, type IpcRegistrar } from "./ipc-handlers";
import type { ProviderService } from "./provider-service";
import type { SessionRepository } from "./session-repository";
import type { WorkspaceRepository } from "./workspace-repository";

describe("registerIpcHandlers", () => {
  it("registers grouped APIs and validates untrusted renderer input", async () => {
    const fixture = createFixture();
    registerIpcHandlers(fixture.options);

    expect(fixture.handlers.has(IPC_CHANNELS.providersList)).toBe(true);
    expect(fixture.handlers.has(IPC_CHANNELS.turnsStart)).toBe(true);
    expect(fixture.handlers.has(IPC_CHANNELS.skillsList)).toBe(true);
    expect(fixture.handlers.has(IPC_CHANNELS.mcpGet)).toBe(true);
    await expect(
      fixture.invoke(IPC_CHANNELS.turnsStart, {
        sessionId: "invalid",
        prompt: "hello",
      }),
    ).rejects.toThrow();
    await expect(
      fixture.invoke(IPC_CHANNELS.sessionsGet, "sf_session_../../providers"),
    ).rejects.toThrow();
    expect(fixture.start).not.toHaveBeenCalled();
  });

  it("registers Skills and MCP APIs with payload validation", async () => {
    const fixture = createFixture();
    registerIpcHandlers(fixture.options);

    await expect(fixture.invoke(IPC_CHANNELS.skillsList)).resolves.toEqual([]);
    await expect(fixture.invoke(IPC_CHANNELS.skillsImportZip)).resolves.toMatchObject({
      invocationName: "/code-review",
    });
    await expect(fixture.invoke(IPC_CHANNELS.skillsSetEnabled, {
      skillId: "code-review",
      enabled: false,
    })).resolves.toMatchObject({ enabled: false });
    await expect(fixture.invoke(IPC_CHANNELS.skillsRemove, "code-review")).resolves.toBeUndefined();
    await expect(fixture.invoke(IPC_CHANNELS.mcpGet)).resolves.toMatchObject({
      schemaVersion: 1,
    });
    await expect(fixture.invoke(IPC_CHANNELS.mcpSave, {
      rawJson: "{\"mcpServers\":{}}",
    })).resolves.toMatchObject({ schemaVersion: 1 });
    await expect(fixture.invoke(IPC_CHANNELS.mcpTestServer, "github")).resolves.toMatchObject({
      name: "github",
    });
    await expect(fixture.invoke(IPC_CHANNELS.skillsSetEnabled, {
      skillId: "",
      enabled: false,
    })).rejects.toThrow("Invalid IPC payload");
    await expect(fixture.invoke(IPC_CHANNELS.mcpSave, {
      rawJson: "",
    })).rejects.toThrow("Invalid IPC payload");
  });

  it("creates sessions with the current default provider without exposing its key", async () => {
    const fixture = createFixture();
    registerIpcHandlers(fixture.options);

    await fixture.invoke(IPC_CHANNELS.sessionsCreate, {
      workspaceId: "workspace-1",
    });

    expect(fixture.createSession).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
    });
  });

  it("registers settings APIs and validates response mode input", async () => {
    const fixture = createFixture();
    registerIpcHandlers(fixture.options);

    await expect(fixture.invoke(IPC_CHANNELS.settingsGet)).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "auto",
      developerMode: false,
    });
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, { responseMode: "smooth" }),
    ).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "smooth",
      developerMode: false,
    });
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, { developerMode: true }),
    ).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "auto",
      developerMode: true,
    });
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, { responseMode: "unsupported" }),
    ).rejects.toThrow();
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, { developerMode: "yes" }),
    ).rejects.toThrow("Invalid IPC payload");
  });
});

function createFixture() {
  const handlers = new Map<string, (event: unknown, input: unknown) => unknown>();
  const ipc: IpcRegistrar = {
    handle: (channel, listener) => {
      handlers.set(channel, listener);
    },
    removeHandler: (channel) => {
      handlers.delete(channel);
    },
  };
  const start = vi.fn();
  const createSession = vi.fn(async (input) => ({
    schemaVersion: 1,
    id: "sf_session_created",
    title: "New session",
    status: "idle",
    messages: [],
    ...input,
  }));
  const providers = {
    list: vi.fn(async () => [{
      providerId: "deepseek",
      displayName: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      recommendedModels: ["deepseek-v4-pro"],
      isDefault: true,
      hasSecret: true,
      lastTestStatus: "success",
    }]),
    save: vi.fn(),
    test: vi.fn(),
    clearSecret: vi.fn(),
    setDefault: vi.fn(),
    discoverModels: vi.fn(),
  } as unknown as ProviderService;
  const workspaces = {
    list: vi.fn(),
    open: vi.fn(),
    remove: vi.fn(),
  } as unknown as WorkspaceRepository;
  const sessions = {
    list: vi.fn(),
    create: createSession,
    get: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
  } as unknown as SessionRepository;
  const settings = {
    get: vi.fn(async () => ({
      schemaVersion: 1 as const,
      responseMode: "auto" as const,
      developerMode: false,
    })),
    save: vi.fn(async (input) => ({
      schemaVersion: 1 as const,
      responseMode: "auto" as const,
      developerMode: false,
      ...input,
    })),
  } as unknown as AppSettingsStore;
  const skills = {
    list: vi.fn(async () => []),
    importZip: vi.fn(async () => ({
      id: "code-review",
      name: "Code Review",
      description: "Review code",
      invocationName: "/code-review" as const,
      enabled: true,
      installedAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    })),
    setEnabled: vi.fn(async (skillId: string, enabled: boolean) => ({
      id: skillId,
      name: "Code Review",
      description: "Review code",
      invocationName: "/code-review" as const,
      enabled,
      installedAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    })),
    remove: vi.fn(async () => undefined),
  };
  const mcp = {
    get: vi.fn(async () => ({
      schemaVersion: 1 as const,
      rawJson: "{\"mcpServers\":{}}",
      servers: [],
    })),
    saveRawJson: vi.fn(async (rawJson: string) => ({
      schemaVersion: 1 as const,
      rawJson,
      servers: [],
    })),
    testServer: vi.fn(async (name: string) => ({
      name,
      transport: "stdio" as const,
      enabled: true,
      status: "success" as const,
      tools: [],
    })),
  };
  const coordinator = {
    start,
    stop: vi.fn(),
  } as unknown as AgentCoordinator;

  return {
    handlers,
    start,
    createSession,
    options: {
      ipc,
      providers,
      workspaces,
      sessions,
      settings,
      coordinator,
      selectWorkspace: async () => undefined,
      skills,
      mcp,
      selectSkillArchive: async () => "/tmp/skill.zip",
    },
    invoke: async (channel: string, input?: unknown) => {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`Missing handler: ${channel}`);
      }
      return handler({}, input);
    },
  };
}
