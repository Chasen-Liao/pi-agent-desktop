import { spawnSync, type ChildProcess } from "child_process";

export function killProcessTree(proc: ChildProcess): Error | null {
  if (process.platform === "win32" && proc.pid) {
    const result = spawnSync("taskkill.exe", ["/PID", String(proc.pid), "/F", "/T"], { windowsHide: true });
    return result.error ?? null;
  }

  proc.kill();
  return null;
}
