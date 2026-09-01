import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  safeStorage,
} from "electron";
import { join } from "node:path";
import { IPC_CHANNELS } from "../shared/story-forge-api";
import {
  AgentCoordinator,
  AgentRunRepository,
  migrateLegacyStoryForgeHome,
  PiModelService,
  PiSessionAdapter,
  resolveStoryForgePaths,
  SessionRepository,
  SoulRepository,
} from "@story-forge/agent";
import { AppSettingsStore } from "./app-settings-store";
import { AutomationRepository } from "./automation-repository";
import { createScheduleCronGenerator } from "./automation-schedule-generator";
import { AutomationScheduler } from "./automation-scheduler";
import { AutomationService } from "./automation-service";
import { loadStoryForgeDotEnv } from "./env-loader";
import { GitRepositoryService } from "./git-repository-service";
import { registerIpcHandlers } from "./ipc-handlers";
import { McpConfigService } from "./mcp-config-service";
import { ProviderService } from "./provider-service";
import { SkillService } from "./skill-service";
import { WorkspaceRepository } from "./workspace-repository";

const APP_ICON_PATH = join(__dirname, "../../resources/icon.png");

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: "StoryForge",
    icon: APP_ICON_PATH,
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
  await loadStoryForgeDotEnv(app.getAppPath());
  const legacyRootDir = app.getPath("userData");
  const paths = resolveStoryForgePaths();
  const migration = await migrateLegacyStoryForgeHome({ legacyRootDir, paths });
  if (migration.status === "migrated") {
    console.info(`Migrated ${migration.copiedFiles} StoryForge data files to ${paths.rootDir}`);
  }
  process.env.PI_CODING_AGENT_DIR = paths.agentDir;
  const rootDir = paths.rootDir;
  const settingsStore = new AppSettingsStore({ rootDir });
  const piModels = new PiModelService({ rootDir });
  const workspaceRepository = new WorkspaceRepository({ rootDir });
  const gitRepositoryService = new GitRepositoryService({
    workspaces: workspaceRepository,
  });
  await piModels.migrateLegacyCredentials({
    crypto: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      decryptString: (value) => safeStorage.decryptString(value),
    },
  });
  const piSessions = new PiSessionAdapter({
    rootDir,
    workspaces: workspaceRepository,
    piModels,
  });
  const agentRunRepository = new AgentRunRepository({ rootDir });
  const sessionRepository = new SessionRepository({
    rootDir,
    piAdapter: piSessions,
    agentRunStore: agentRunRepository,
  });
  const soulRepository = new SoulRepository({ filePath: paths.soulPath });
  const skillService = new SkillService({ rootDir });
  const mcpConfigService = new McpConfigService({ rootDir });
  const automationService = new AutomationService({
    repository: new AutomationRepository({ rootDir }),
    generateCron: createScheduleCronGenerator(piModels),
  });
  await sessionRepository.recoverInterruptedSessions();
  await agentRunRepository.recoverInterruptedRuns();
  await automationService.recoverRunningRuns();
  const providerService = new ProviderService({
    piModels,
    sessions: sessionRepository,
  });
  const coordinator = new AgentCoordinator({
    sessionRepository,
    workspaceRepository,
    piModels,
    piSessions,
    agentRunRepository,
    skillResolver: skillService,
    mcpServerSource: mcpConfigService,
    soulStore: soulRepository,
    getDeveloperMode: async () => (await settingsStore.get()).developerMode,
    getCommandExecutionMode: async () => (await settingsStore.get()).commandExecutionMode,
    getWebAccessEnabled: async () => (await settingsStore.get()).webAccessEnabled,
    getWebSearchCoverage: async () => (await settingsStore.get()).webSearchCoverage,
    getSoulMode: async () => (await settingsStore.get()).soulMode,
    emit: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.turnEvent, event);
      }
    },
  });
  const automationScheduler = new AutomationScheduler({
    service: automationService,
    coordinator,
    onError: (error) => {
      console.error("Automation scheduler error", error);
    },
  });
  automationScheduler.start();

  registerIpcHandlers({
    ipc: ipcMain,
    providers: providerService,
    workspaces: workspaceRepository,
    git: gitRepositoryService,
    sessions: sessionRepository,
    settings: settingsStore,
    soul: soulRepository,
    coordinator,
    skills: skillService,
    mcp: mcpConfigService,
    automations: automationScheduler,
    selectWorkspace: async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        title: "Open StoryForge workspace",
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
    selectSkillArchive: async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "Skill archives", extensions: ["zip"] }],
        title: "Import StoryForge skill",
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
  });
  createWindow();
}

void app.whenReady().then(() => {
  if (process.platform === "darwin") {
    const dockIcon = nativeImage.createFromPath(APP_ICON_PATH);
    if (!dockIcon.isEmpty()) {
      app.dock?.setIcon(dockIcon);
    }
  }
  return initializeApplication();
});

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
