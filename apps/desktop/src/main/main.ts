import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { createDesktopRuntime, type DesktopProviderConfig } from "./runtime-factory";

type RunTurnInput = {
  workspaceRoot: string;
  providerConfig: DesktopProviderConfig;
  prompt: string;
};

ipcMain.handle("agent:run-turn", async (_event, input: RunTurnInput) => {
  const runtime = createDesktopRuntime({
    workspaceRoot: input.workspaceRoot,
    providerConfig: input.providerConfig,
  });

  const events = [];
  for await (const event of runtime.runTurn(input.prompt)) {
    events.push(event);
  }

  return events;
});

function createWindow(): void {
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
}

app.whenReady().then(createWindow);

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
