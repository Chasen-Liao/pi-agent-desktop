import { spawnSync, type ChildProcess } from "child_process";

function getUnixChildren(pid: number): number[] {
  try {
    const pgrepResult = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
    if (pgrepResult.status === 0 && pgrepResult.stdout) {
      return pgrepResult.stdout
        .split(/\s+/)
        .map((x) => parseInt(x.trim(), 10))
        .filter((x) => !isNaN(x));
    }
  } catch {
    // ignore
  }

  try {
    const psResult = spawnSync("ps", ["-o", "pid=", "--ppid", String(pid)], { encoding: "utf8" });
    if (psResult.status === 0 && psResult.stdout) {
      return psResult.stdout
        .split(/\s+/)
        .map((x) => parseInt(x.trim(), 10))
        .filter((x) => !isNaN(x));
    }
  } catch {
    // ignore
  }

  return [];
}

function killUnixProcessTree(pid: number, signal: NodeJS.Signals | number = "SIGKILL") {
  const children = getUnixChildren(pid);
  for (const childPid of children) {
    killUnixProcessTree(childPid, signal);
  }
  try {
    process.kill(pid, signal);
  } catch {
    // ignore
  }
}

export function killProcessTree(proc: ChildProcess): Error | null {
  if (!proc.pid) {
    return null;
  }

  if (process.platform === "win32") {
    const result = spawnSync("taskkill.exe", ["/PID", String(proc.pid), "/F", "/T"], { windowsHide: true });
    return result.error ?? null;
  }

  try {
    killUnixProcessTree(proc.pid, "SIGKILL");
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

