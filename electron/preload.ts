import type { IpcRendererEvent } from "electron";
import { contextBridge, ipcRenderer, webUtils } from "electron";

const preloadPage = globalThis as typeof globalThis & {
  addEventListener?: (event: string, listener: () => void) => void;
  document?: {
    documentElement?: {
      dataset: Record<string, string | undefined>;
    };
  };
};

preloadPage.addEventListener?.("DOMContentLoaded", () => {
  const dataset = preloadPage.document?.documentElement?.dataset;
  if (dataset) {
    dataset.electronPlatform = process.platform;
  }
});

contextBridge.exposeInMainWorld("electronAPI", {
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  /** Resolve a drag-dropped File to its absolute filesystem path (Electron only). */
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
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
