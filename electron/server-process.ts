import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { UtilityProcess } from "electron";

export type ServerProcessExitListener = (
  code: number | null,
  signal: NodeJS.Signals | null,
) => void;

export class ServerProcess extends EventEmitter {
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  private readonly getPid: () => number | undefined;
  private readonly getExitCode: () => number | null;
  private readonly getKilled: () => boolean;
  private readonly terminateProcess: () => Error | null;

  constructor(
    stdout: NodeJS.ReadableStream | null,
    stderr: NodeJS.ReadableStream | null,
    getPid: () => number | undefined,
    getExitCode: () => number | null,
    getKilled: () => boolean,
    terminateProcess: () => Error | null,
  ) {
    super();
    this.stdout = stdout;
    this.stderr = stderr;
    this.getPid = getPid;
    this.getExitCode = getExitCode;
    this.getKilled = getKilled;
    this.terminateProcess = terminateProcess;
  }

  get pid(): number | undefined {
    return this.getPid();
  }

  get exitCode(): number | null {
    return this.getExitCode();
  }

  get killed(): boolean {
    return this.getKilled();
  }

  terminate(): Error | null {
    return this.terminateProcess();
  }
}

export function wrapChildServerProcess(
  child: ChildProcess,
  terminateChild: (child: ChildProcess) => Error | null,
): ServerProcess {
  const process = new ServerProcess(
    child.stdout,
    child.stderr,
    () => child.pid,
    () => child.exitCode,
    () => child.killed,
    () => terminateChild(child),
  );

  child.on("exit", (code, signal) => process.emit("exit", code, signal));
  child.on("error", (error) => process.emit("error", error));
  return process;
}

export function wrapUtilityServerProcess(
  utility: UtilityProcess,
  terminateUtility: (utility: UtilityProcess) => Error | null,
): ServerProcess {
  let exitCode: number | null = null;
  let killed = false;

  const process = new ServerProcess(
    utility.stdout,
    utility.stderr,
    () => utility.pid,
    () => exitCode,
    () => killed || exitCode !== null,
    () => {
      const error = terminateUtility(utility);
      killed = true;
      return error;
    },
  );

  utility.on("exit", (code) => {
    exitCode = code;
    process.emit("exit", code, null);
  });
  utility.on("error", (type, location, report) => {
    const error = new Error(
      `Utility process ${type} at ${location || "unknown location"}`,
    );
    error.cause = report;
    process.emit("error", error);
  });
  return process;
}
