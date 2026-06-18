import { ProviderRegistry } from "@story-forge/model-gateway";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
} from "electron";
import { join } from "node:path";
import { IPC_CHANNELS } from "../shared/story-forge-api";
import { AgentCoordinator } from "./agent-coordinator";
import { AppSettingsStore } from "./app-settings-store";
import { registerIpcHandlers } from "./ipc-handlers";
import { ProviderConfigStore } from "./provider-config-store";
import { ProviderService } from "./provider-service";
import { SessionRepository } from "./session-repository";
import { WorkspaceRepository } from "./workspace-repository";

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: "StoryForge",
    backgroundColor: "#f4f6f8",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return window;
}

async function initializeApplication(): Promise<void> {
  const rootDir = app.getPath("userData");
  const settingsStore = new AppSettingsStore({ rootDir });
  const providerStore = new ProviderConfigStore({
    rootDir,
    crypto: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value),
    },
  });
  const workspaceRepository = new WorkspaceRepository({ rootDir });
  const sessionRepository = new SessionRepository({ rootDir });
  await sessionRepository.recoverInterruptedSessions();
  const registry = new ProviderRegistry();
  const providerService = new ProviderService({ store: providerStore, registry });
  const coordinator = new AgentCoordinator({
    providerStore,
    sessionRepository,
    workspaceRepository,
    providerFactory: registry,
    getResponseMode: async () => (await settingsStore.get()).responseMode,
    emit: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.turnEvent, event);
      }
    },
  });

  registerIpcHandlers({
    ipc: ipcMain,
    providers: providerService,
    workspaces: workspaceRepository,
    sessions: sessionRepository,
    settings: settingsStore,
    coordinator,
    selectWorkspace: async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        title: "Open StoryForge workspace",
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
  });
  createWindow();
}

void app.whenReady().then(initializeApplication);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
