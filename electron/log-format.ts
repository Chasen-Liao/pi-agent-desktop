export type ElectronLogLevel = "info" | "error";

export interface ElectronLogEntryInput {
  time?: string;
  level: ElectronLogLevel;
  source: "electron-main";
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

export function formatElectronLogLine(input: ElectronLogEntryInput): string {
  return `${JSON.stringify({
    time: input.time ?? new Date().toISOString(),
    level: input.level,
    source: input.source,
    message: input.message,
    ...(input.detail === undefined ? {} : { detail: normalizeLogDetail(input.detail) }),
  })}\n`;
}
