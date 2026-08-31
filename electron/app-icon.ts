import path from "path";

export function getAppIconPath(appPath: string, platform: NodeJS.Platform = process.platform): string {
  const iconName = platform === "darwin" ? "icon.icns" : "icon.ico";
  return path.join(appPath, "build", iconName);
}
