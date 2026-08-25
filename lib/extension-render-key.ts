import type { ExtensionInfo } from "./extensions-config";

export function getExtensionRenderKey(
  extension: Pick<ExtensionInfo, "scope" | "source" | "path">
): string {
  return `${extension.scope}:${extension.source}:${extension.path}`;
}
