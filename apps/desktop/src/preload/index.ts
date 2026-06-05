import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("storyForge", {
  version: "0.1.0",
});
