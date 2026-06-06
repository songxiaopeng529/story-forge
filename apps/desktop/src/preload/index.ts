import type { AgentEvent, SessionId, TurnId } from "@story-forge/shared";
import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type StoryForgeApi,
} from "../shared/story-forge-api";

const api = {
  version: "0.1.0",
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
} satisfies StoryForgeApi;

contextBridge.exposeInMainWorld("storyForge", api);
