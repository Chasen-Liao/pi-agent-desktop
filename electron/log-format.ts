export type ElectronLogLevel = "info" | "error";
export type ElectronLogSource = "electron-main" | "electron-renderer" | "next-api";

export interface ElectronLogEntryInput {
  time?: string;
  level: ElectronLogLevel;
  source: ElectronLogSource;
  scope: string;
  message: string;
  detail?: unknown;
}

function normalizeLogDetail(detail: unknown): unknown {
  if (detail instanceof Error) {
    return {
      name: detail.name,
      message: detail.message,
      stack: detail.stack,
    };
  }
  return detail;
}

export function deriveScope(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "main";
  return trimmed.split(/\s+/, 1)[0]?.replace(/[^A-Za-z0-9_/.-]/g, "_") ?? "main";
}

export function formatElectronLogLine(input: ElectronLogEntryInput): string {
  return `${JSON.stringify({
    time: input.time ?? new Date().toISOString(),
    level: input.level,
    source: input.source,
    scope: input.scope,
    message: input.message,
    ...(input.detail === undefined ? {} : { detail: normalizeLogDetail(input.detail) }),
  })}\n`;
}
