import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("storyForge", {
  version: "0.1.0",
  runTurn: (input: unknown) => ipcRenderer.invoke("agent:run-turn", input) as Promise<unknown[]>,
});
