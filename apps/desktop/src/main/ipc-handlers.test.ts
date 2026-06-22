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
    expect(fixture.handlers.has(IPC_CHANNELS.automationsList)).toBe(true);
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
      commandExecutionMode: "sentinel",
      webAccessEnabled: false,
      webSearchCoverage: "focused",
    });
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, { responseMode: "smooth" }),
    ).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "smooth",
      developerMode: false,
      commandExecutionMode: "sentinel",
      webAccessEnabled: false,
      webSearchCoverage: "focused",
    });
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, { developerMode: true }),
    ).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "auto",
      developerMode: true,
      commandExecutionMode: "sentinel",
      webAccessEnabled: false,
      webSearchCoverage: "focused",
    });
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, { commandExecutionMode: "cruise" }),
    ).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "auto",
      developerMode: false,
      commandExecutionMode: "cruise",
      webAccessEnabled: false,
      webSearchCoverage: "focused",
    });
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, {
        webAccessEnabled: true,
        webSearchCoverage: "wide",
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "auto",
      developerMode: false,
      commandExecutionMode: "sentinel",
      webAccessEnabled: true,
      webSearchCoverage: "wide",
    });
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, { responseMode: "unsupported" }),
    ).rejects.toThrow();
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, { developerMode: "yes" }),
    ).rejects.toThrow("Invalid IPC payload");
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, { commandExecutionMode: "chaos" }),
    ).rejects.toThrow("Invalid IPC payload");
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, { webSearchCoverage: "expensive" }),
    ).rejects.toThrow("Invalid IPC payload");
  });

  it("registers permission response IPC", async () => {
    const fixture = createFixture();
    registerIpcHandlers(fixture.options);

    await expect(
      fixture.invoke(IPC_CHANNELS.permissionRespond, {
        requestId: "permission_1",
        approved: true,
      }),
    ).resolves.toBeUndefined();
    expect(fixture.respondToPermission).toHaveBeenCalledWith({
      requestId: "permission_1",
      approved: true,
    });
    await expect(
      fixture.invoke(IPC_CHANNELS.permissionRespond, {
        requestId: "",
        approved: true,
      }),
    ).rejects.toThrow("Invalid IPC payload");
  });

  it("registers Automations APIs with payload validation", async () => {
    const fixture = createFixture();
    registerIpcHandlers(fixture.options);

    await expect(fixture.invoke(IPC_CHANNELS.automationsList)).resolves.toEqual([]);
    await expect(fixture.invoke(IPC_CHANNELS.automationsValidateSchedule, {
      cron: "0 9 * * *",
      timezone: "Asia/Shanghai",
    })).resolves.toMatchObject({ ok: true });
    await expect(fixture.invoke(IPC_CHANNELS.automationsInterpretSchedule, {
      scheduleText: "每天上午 9 点",
      timezone: "Asia/Shanghai",
    })).resolves.toMatchObject({ ok: true });
    await expect(fixture.invoke(IPC_CHANNELS.automationsCreate, {
      name: "Daily check",
      status: "active",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      schedule: {
        sourceText: "每天上午 9 点",
        cron: "0 9 * * *",
        timezone: "Asia/Shanghai",
        summary: "Every day at 09:00",
      },
      prompt: "Check dependency risk.",
    })).resolves.toMatchObject({
      name: "Daily check",
    });
    await expect(fixture.invoke(IPC_CHANNELS.automationsCreate, {
      name: "Thread timer",
      kind: "thread_chat",
      status: "active",
      workspaceId: "workspace-1",
      providerId: "deepseek",
      model: "deepseek-v4-pro",
      sessionId: "sf_session_existing",
      schedule: {
        sourceText: "every hour",
        cron: "0 * * * *",
        timezone: "UTC",
        summary: "Every hour",
      },
      prompt: "Check the current session.",
    })).resolves.toMatchObject({
      kind: "thread_chat",
      sessionId: "sf_session_existing",
    });
    await expect(fixture.invoke(IPC_CHANNELS.automationsUpdate, {
      automationId: "automation-1",
      status: "paused",
    })).resolves.toMatchObject({ status: "paused" });
    await expect(fixture.invoke(IPC_CHANNELS.automationsRunNow, "automation-1"))
      .resolves.toMatchObject({ automationId: "automation-1" });
    await expect(fixture.invoke(IPC_CHANNELS.automationsGetRuns, "automation-1"))
      .resolves.toEqual([]);
    await expect(fixture.invoke(IPC_CHANNELS.automationsDelete, "automation-1"))
      .resolves.toBeUndefined();
    await expect(fixture.invoke(IPC_CHANNELS.automationsCreate, {
      name: "",
    })).rejects.toThrow("Invalid IPC payload");
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
      commandExecutionMode: "sentinel" as const,
      webAccessEnabled: false,
      webSearchCoverage: "focused" as const,
    })),
    save: vi.fn(async (input) => ({
      schemaVersion: 1 as const,
      responseMode: "auto" as const,
      developerMode: false,
      commandExecutionMode: "sentinel" as const,
      webAccessEnabled: false,
      webSearchCoverage: "focused" as const,
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
  const automations = {
    list: vi.fn(async () => []),
    getRuns: vi.fn(async () => []),
    validateSchedule: vi.fn(async () => ({
      ok: true as const,
      cron: "0 9 * * *",
      timezone: "Asia/Shanghai",
      summary: "Every day at 09:00",
      nextRuns: ["2026-06-20T01:00:00.000Z"],
    })),
    interpretSchedule: vi.fn(async () => ({
      ok: true as const,
      cron: "0 9 * * *",
      timezone: "Asia/Shanghai",
      summary: "Every day at 09:00",
      nextRuns: ["2026-06-20T01:00:00.000Z"],
    })),
    create: vi.fn(async (input) => ({
      schemaVersion: 1 as const,
      id: "automation-1",
      kind: "scheduled_chat" as const,
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
      ...input,
    })),
    update: vi.fn(async (input) => ({
      schemaVersion: 1 as const,
      id: input.automationId,
      kind: "scheduled_chat" as const,
      name: "Daily check",
      status: "active" as const,
      workspaceId: "workspace-1",
      providerId: "deepseek" as const,
      model: "deepseek-v4-pro",
      schedule: {
        sourceText: "每天上午 9 点",
        cron: "0 9 * * *",
        timezone: "Asia/Shanghai",
        summary: "Every day at 09:00",
      },
      prompt: "Check dependency risk.",
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
      ...input,
    })),
    delete: vi.fn(async () => undefined),
    runNow: vi.fn(async (automationId: string) => ({
      schemaVersion: 1 as const,
      id: "run-1",
      automationId,
      status: "scheduled" as const,
      scheduledFor: "2026-06-20T00:00:00.000Z",
    })),
  };
  const coordinator = {
    start,
    stop: vi.fn(),
    respondToPermission: vi.fn(),
  } as unknown as AgentCoordinator;

  return {
    handlers,
    start,
    createSession,
    respondToPermission: coordinator.respondToPermission,
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
      automations,
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
