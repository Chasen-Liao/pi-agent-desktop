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
