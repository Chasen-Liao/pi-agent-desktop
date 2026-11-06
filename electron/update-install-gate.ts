/**
 * Pure gate for quit-and-install IPC: only allow install after an update was downloaded.
 */

export type UpdateInstallState = {
  updateDownloaded: boolean;
  downloadedVersion: string | null;
};

export function createUpdateInstallState(): UpdateInstallState {
  return { updateDownloaded: false, downloadedVersion: null };
}

export function markUpdateDownloaded(
  state: UpdateInstallState,
  version: string
): UpdateInstallState {
  return { updateDownloaded: true, downloadedVersion: version };
}

export function canQuitAndInstall(state: UpdateInstallState): boolean {
  return state.updateDownloaded === true;
}

export type QuitAndInstallDecision =
  | { allowed: true; version: string | null }
  | { allowed: false; reason: string };

export function decideQuitAndInstall(state: UpdateInstallState): QuitAndInstallDecision {
  if (!canQuitAndInstall(state)) {
    return { allowed: false, reason: "No update has been downloaded" };
  }
  return { allowed: true, version: state.downloadedVersion };
}

export type UpdateCheckPhase =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"
  | "unsupported";

export type UpdateStatusPayload = {
  status: UpdateCheckPhase;
  currentVersion: string;
  availableVersion: string | null;
  downloadedVersion: string | null;
  percent: number | null;
  transferred: number | null;
  total: number | null;
  error: string | null;
  checkedAt: number | null;
};

export function createUpdateStatusPayload(currentVersion = "0.0.0"): UpdateStatusPayload {
  return {
    status: "idle",
    currentVersion,
    availableVersion: null,
    downloadedVersion: null,
    percent: null,
    transferred: null,
    total: null,
    error: null,
    checkedAt: null,
  };
}

export function transitionUpdateStatus(
  prev: UpdateStatusPayload,
  event:
    | { type: "checking"; now?: number }
    | { type: "available"; version: string; now?: number }
    | { type: "not-available"; version?: string; now?: number }
    | { type: "downloading"; percent: number; transferred: number; total: number }
    | { type: "downloaded"; version: string; now?: number }
    | { type: "error"; message: string; now?: number }
    | { type: "unsupported"; now?: number }
): UpdateStatusPayload {
  const now = "now" in event && typeof event.now === "number" ? event.now : Date.now();
  switch (event.type) {
    case "checking":
      if (prev.status === "downloaded") {
        return {
          ...prev,
          error: null,
          checkedAt: now,
        };
      }
      return {
        ...prev,
        status: "checking",
        error: null,
        checkedAt: now,
      };
    case "available":
      return {
        ...prev,
        status: "available",
        availableVersion: event.version,
        error: null,
        checkedAt: now,
      };
    case "not-available":
      return {
        ...prev,
        status: "not-available",
        availableVersion: null,
        error: null,
        checkedAt: now,
      };
    case "downloading":
      return {
        ...prev,
        status: "downloading",
        percent: Math.max(0, Math.min(100, event.percent)),
        transferred: event.transferred,
        total: event.total,
        error: null,
      };
    case "downloaded":
      return {
        ...prev,
        status: "downloaded",
        availableVersion: event.version,
        downloadedVersion: event.version,
        percent: 100,
        error: null,
        checkedAt: now,
      };
    case "error":
      return {
        ...prev,
        status: "error",
        error: event.message,
        checkedAt: now,
      };
    case "unsupported":
      return {
        ...prev,
        status: "unsupported",
        error: null,
        checkedAt: now,
      };
  }
}

