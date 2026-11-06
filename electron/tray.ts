import { app, Menu, Tray, BrowserWindow, nativeImage } from "electron";
import { setQuitting } from "./main";
import { getAppIconPath } from "./app-icon";

const FALLBACK_ICON_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFElEQVQ4y2N" +
    "kwAT/GYYBYwYDAKLuAf8LSXNHAAAAABJRU5ErkJggg==",
  "base64"
);

export interface TrayOptions {
  onOpenSettings?: (tab?: "general" | "agent" | "about") => void;
  onCheckForUpdates?: () => void;
}

export function createTray(mainWindow: BrowserWindow, options?: TrayOptions): Tray {
  const iconPath = getAppIconPath(app.getAppPath());

  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // Fallback: create a minimal 16x16 transparent PNG
      icon = nativeImage.createFromBuffer(FALLBACK_ICON_PNG);
    }
  } catch {
    icon = nativeImage.createFromBuffer(FALLBACK_ICON_PNG);
  }

  const tray = new Tray(icon);
  tray.setToolTip("Pi Agent Desktop");

  const showAndFocus = () => {
    if (!mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  };

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示窗口",
      click: () => {
        showAndFocus();
      },
    },
    {
      label: "设置",
      click: () => {
        showAndFocus();
        options?.onOpenSettings?.("general");
      },
    },
    {
      label: "检查更新",
      click: () => {
        showAndFocus();
        options?.onCheckForUpdates?.();
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        setQuitting(true);
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    showAndFocus();
  });

  return tray;
}

