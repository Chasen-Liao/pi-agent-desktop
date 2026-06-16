import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  onUpdateAvailable: (callback: (info: { version: string }) => void) =>
    ipcRenderer.on("update-available", (_event, info) => callback(info)),
  onUpdateDownloaded: (callback: () => void) =>
    ipcRenderer.on("update-downloaded", () => callback()),
  quitAndInstall: () => ipcRenderer.invoke("quit-and-install"),
  setTheme: (isDark: boolean) => ipcRenderer.send("set-theme", isDark),
});
