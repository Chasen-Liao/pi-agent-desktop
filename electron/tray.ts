import { app, Menu, Tray, BrowserWindow, nativeImage } from "electron";
import path from "path";
import { setQuitting } from "./main";

export function createTray(mainWindow: BrowserWindow): Tray {
  // Use .ico for Windows tray icon (SVG not reliably supported on Win10)
  const iconPath = path.join(app.getAppPath(), "build", "icon.ico");

  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // Fallback: create a minimal 16x16 transparent PNG
      icon = nativeImage.createFromBuffer(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFElEQVQ4y2N" +
            "kwAT/GYYBYwYDAKLuAf8LSXNHAAAAABJRU5ErkJggg==",
          "base64"
        )
      );
    }
  } catch {
    icon = nativeImage.createFromBuffer(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFElEQVQ4y2N" +
          "kwAT/GYYBYwYDAKLuAf8LSXNHAAAAABJRU5ErkJggg==",
          "base64"
      )
    );
  }

  const tray = new Tray(icon);
  tray.setToolTip("Pi Agent Desktop");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示窗口",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
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
    mainWindow.show();
    mainWindow.focus();
  });

  return tray;
}
