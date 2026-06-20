import type { AgentEvent, SessionId, TurnId } from "@story-forge/shared";
import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type StoryForgeApi,
} from "../shared/story-forge-api";

const api = {
  version: "0.1.0",
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    save: (input) => ipcRenderer.invoke(IPC_CHANNELS.settingsSave, input),
  },
  providers: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.providersList),
    save: (input) => ipcRenderer.invoke(IPC_CHANNELS.providersSave, input),
    test: (providerId) => ipcRenderer.invoke(IPC_CHANNELS.providersTest, providerId),
    clearSecret: (providerId) =>
      ipcRenderer.invoke(IPC_CHANNELS.providersClearSecret, providerId),
    setDefault: (providerId) =>
      ipcRenderer.invoke(IPC_CHANNELS.providersSetDefault, providerId),
    discoverModels: (providerId) =>
      ipcRenderer.invoke(IPC_CHANNELS.providersDiscoverModels, providerId),
  },
  workspaces: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.workspacesList),
    open: () => ipcRenderer.invoke(IPC_CHANNELS.workspacesOpen),
    remove: (workspaceId) =>
      ipcRenderer.invoke(IPC_CHANNELS.workspacesRemove, workspaceId),
  },
  sessions: {
    list: (workspaceId) =>
      ipcRenderer.invoke(IPC_CHANNELS.sessionsList, {
        ...(workspaceId ? { workspaceId } : {}),
      }),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.sessionsCreate, input),
    get: (sessionId: SessionId) =>
      ipcRenderer.invoke(IPC_CHANNELS.sessionsGet, sessionId),
    rename: (sessionId: SessionId, title: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.sessionsRename, { sessionId, title }),
    delete: (sessionId: SessionId) =>
      ipcRenderer.invoke(IPC_CHANNELS.sessionsDelete, sessionId),
  },
  turns: {
    start: (input) => ipcRenderer.invoke(IPC_CHANNELS.turnsStart, input),
    stop: (turnId: TurnId) =>
      ipcRenderer.invoke(IPC_CHANNELS.turnsStop, turnId),
    onEvent: (listener: (event: AgentEvent) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, event: AgentEvent) => {
        listener(event);
      };
      ipcRenderer.on(IPC_CHANNELS.turnEvent, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.turnEvent, wrapped);
    },
  },
  permissions: {
    respond: (input) => ipcRenderer.invoke(IPC_CHANNELS.permissionRespond, input),
  },
  automations: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.automationsList),
    getRuns: (automationId) =>
      ipcRenderer.invoke(IPC_CHANNELS.automationsGetRuns, automationId),
    validateSchedule: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.automationsValidateSchedule, input),
    interpretSchedule: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.automationsInterpretSchedule, input),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.automationsCreate, input),
    update: (input) => ipcRenderer.invoke(IPC_CHANNELS.automationsUpdate, input),
    delete: (automationId) =>
      ipcRenderer.invoke(IPC_CHANNELS.automationsDelete, automationId),
    runNow: (automationId) =>
      ipcRenderer.invoke(IPC_CHANNELS.automationsRunNow, automationId),
  },
  skills: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.skillsList),
    importZip: () => ipcRenderer.invoke(IPC_CHANNELS.skillsImportZip),
    setEnabled: (input) => ipcRenderer.invoke(IPC_CHANNELS.skillsSetEnabled, input),
    remove: (skillId) => ipcRenderer.invoke(IPC_CHANNELS.skillsRemove, skillId),
  },
  mcp: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.mcpGet),
    save: (input) => ipcRenderer.invoke(IPC_CHANNELS.mcpSave, input),
    testServer: (name) => ipcRenderer.invoke(IPC_CHANNELS.mcpTestServer, name),
  },
} satisfies StoryForgeApi;

contextBridge.exposeInMainWorld("storyForge", api);
