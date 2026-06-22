import type { IpcRendererEvent } from "electron";
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  onUpdateAvailable: (callback: (info: { version: string }) => void) => {
    const listener = (_event: IpcRendererEvent, info: { version: string }) => callback(info);
    ipcRenderer.on("update-available", listener);
    return () => ipcRenderer.off("update-available", listener);
  },
  onUpdateDownloaded: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("update-downloaded", listener);
    return () => ipcRenderer.off("update-downloaded", listener);
  },
  quitAndInstall: () => ipcRenderer.invoke("quit-and-install"),
  setTheme: (isDark: boolean) => ipcRenderer.send("set-theme", isDark),
});
