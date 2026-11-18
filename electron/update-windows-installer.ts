import { spawn } from "node:child_process";

/** Launch the verified NSIS installer and wait until Windows starts its process. */
export function launchWindowsInstaller(installerPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const installer = spawn(installerPath, ["--updated", "--force-run"], {
      detached: true,
      stdio: "ignore",
    });
    installer.once("error", reject);
    installer.once("spawn", () => {
      installer.unref();
      resolve();
    });
  });
}
