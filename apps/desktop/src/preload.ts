import { contextBridge, ipcRenderer } from "electron";

/** Minimal, safe bridge for the settings page and UI. */
contextBridge.exposeInMainWorld("grokbot", {
  version: process.env.npm_package_version ?? "0.1.0",
  getSettings: () => ipcRenderer.invoke("grokbot:getSettings"),
  saveSettings: (partial: unknown) => ipcRenderer.invoke("grokbot:saveSettings", partial),
  pickFolder: () => ipcRenderer.invoke("grokbot:pickFolder"),
});
