import type { IpcRendererEvent } from "electron";
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { UpdateStatusPayload } from "./update-install-gate";

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
  getAppInfo: (): Promise<{ version: string; isPackaged: boolean; platform: string }> =>
    ipcRenderer.invoke("get-app-info"),
  getUpdateStatus: (): Promise<UpdateStatusPayload> =>
    ipcRenderer.invoke("get-update-status"),
  checkForUpdates: (): Promise<UpdateStatusPayload> =>
    ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("download-update"),
  onUpdateStatus: (callback: (status: UpdateStatusPayload) => void) => {
    const listener = (_event: IpcRendererEvent, status: UpdateStatusPayload) => callback(status);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.off("update-status", listener);
  },
  onOpenSettings: (callback: (payload: { tab?: "general" | "agent" | "about" }) => void) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: { tab?: "general" | "agent" | "about" }
    ) => callback(payload ?? {});
    ipcRenderer.on("open-settings", listener);
    return () => ipcRenderer.off("open-settings", listener);
  },
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
  setCloseAction: (action: "tray" | "quit") => ipcRenderer.send("set-close-action", action),
});


