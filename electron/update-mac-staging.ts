/** Stage the downloaded zip before MacUpdater.quitAndInstall. This avoids its
 * persistent per-call listener, which otherwise survives a failed attempt. */
export function stageMacUpdate(updater: {
  once(event: "update-downloaded" | "update-not-available", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  removeListener(event: "update-downloaded" | "update-not-available", listener: () => void): unknown;
  removeListener(event: "error", listener: (error: Error) => void): unknown;
  checkForUpdates(): unknown;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      updater.removeListener("update-downloaded", onDownloaded);
      updater.removeListener("update-not-available", onUnavailable);
      updater.removeListener("error", onError);
    };
    const onDownloaded = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onUnavailable = () => onError(new Error("Native updater reported no update to stage"));
    updater.once("update-downloaded", onDownloaded);
    updater.once("update-not-available", onUnavailable);
    updater.once("error", onError);
    try { updater.checkForUpdates(); } catch (error) { cleanup(); reject(error); }
  });
}
