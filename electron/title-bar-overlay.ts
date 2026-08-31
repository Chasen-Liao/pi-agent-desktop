export interface TitleBarOverlayTarget {
  setTitleBarOverlay?: (options: {
    color: string;
    symbolColor: string;
  }) => void;
}

/**
 * Updates window controls where the Electron runtime exposes title-bar overlays.
 * The API is unavailable on macOS and may be absent in some Electron builds.
 */
export function applyTitleBarOverlayTheme(
  target: TitleBarOverlayTarget | null,
  isDark: boolean,
): boolean {
  if (typeof target?.setTitleBarOverlay !== "function") {
    return false;
  }

  target.setTitleBarOverlay({
    color: isDark ? "#0c1118" : "#ffffff",
    symbolColor: isDark ? "#d9deea" : "#364152",
  });
  return true;
}
