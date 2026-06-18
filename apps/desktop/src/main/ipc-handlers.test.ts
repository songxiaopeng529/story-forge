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
    });
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, { responseMode: "smooth" }),
    ).resolves.toEqual({
      schemaVersion: 1,
      responseMode: "smooth",
    });
    await expect(
      fixture.invoke(IPC_CHANNELS.settingsSave, { responseMode: "unsupported" }),
    ).rejects.toThrow();
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
    })),
    save: vi.fn(async (input) => ({
      schemaVersion: 1 as const,
      ...input,
    })),
  } as unknown as AppSettingsStore;
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
