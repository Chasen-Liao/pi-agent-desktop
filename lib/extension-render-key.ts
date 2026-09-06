export function getExtensionRenderKey(extension: {
  scope: string;
  source: string;
  path: string;
}): string {
  return `${extension.scope}:${extension.source}:${extension.path}`;
}
