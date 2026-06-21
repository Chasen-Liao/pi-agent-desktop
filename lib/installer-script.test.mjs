import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const installerScript = readFileSync(new URL("../build/installer.nsh", import.meta.url), "utf8");

function macroBody(name) {
  const match = installerScript.match(new RegExp(`!macro ${name}\\b([\\s\\S]*?)!macroend`));
  assert.ok(match, `missing ${name} macro`);
  return match[1];
}

test("installer closes current and legacy app processes before install", () => {
  const closeAll = macroBody("closeAppProcesses");
  const closeOne = macroBody("closeAppProcess");
  assert.match(closeAll, /Pi Agent Desktop\.exe/);
  assert.match(closeAll, /PipeAgent\.exe/);
  assert.match(closeAll, /closeInstallDirProcesses/);
  assert.match(closeOne, /taskkill/);
  assert.match(closeOne, /\/F \/T \/IM/);
  assert.doesNotMatch(closeOne, /DetailPrint "Closing running/);
  assert.doesNotMatch(closeOne, /ExecToLog/);
  assert.doesNotMatch(closeOne, /nsProcess::_FindProcess/);
  // closeInstallDirProcesses uses `Get-Process` (fast in-process) instead of
  // `Get-CimInstance Win32_Process` (slow WMI round-trip). The process filter
  // checks `Path` (Path property on Get-Process objects, not WMI ExecutablePath),
  // `Name -in @(...)`, and `CommandLine` IndexOf to catch nodes whose Path is
  // the bundled node.exe but whose CommandLine references the install dir.
  const closeDir = macroBody("closeInstallDirProcesses");
  assert.match(closeDir, /Get-Process/);
  assert.match(closeDir, /Stop-Process/);
  assert.match(closeDir, /\$\$_\.Path/);
  assert.match(closeDir, /\$\$_\.CommandLine/);
  assert.match(closeDir, /\$\$_\.Name -in/);
  assert.match(closeDir, /Pi Agent Desktop/);
  assert.match(closeDir, /Out-File/);
  assert.doesNotMatch(closeDir, /ExecToLog/);
  assert.match(macroBody("customCheckAppRunning"), /closeAppProcesses/);
  assert.match(macroBody("customInit"), /closeAppProcesses/);
  assert.match(macroBody("customInstall"), /closeAppProcesses/);
});

test("installer closes current and legacy app processes before uninstall", () => {
  assert.match(macroBody("closeAppProcesses"), /PipeAgent\.exe/);
  assert.match(macroBody("customUnInit"), /closeAppProcesses/);
  assert.match(macroBody("customUnInstall"), /closeAppProcesses/);
});

test("installer writes persistent diagnostic logs for install and uninstall", () => {
  assert.match(installerScript, /PI_AGENT_INSTALLER_LOG_DIR/);
  assert.match(installerScript, /PI_AGENT_INSTALLER_LOG_FILE/);
  assert.match(installerScript, /installer\.log/);
  assert.match(macroBody("initInstallerLogging"), /CreateDirectory/);
  assert.match(macroBody("appendInstallerLog"), /FileOpen/);
  assert.match(macroBody("appendInstallerLog"), /FileWrite/);
  assert.match(macroBody("closeAppProcess"), /appendInstallerLog/);
  assert.match(macroBody("closeInstallDirProcesses"), /appendInstallerLog/);
  assert.match(macroBody("customInit"), /initInstallerLogging/);
  assert.match(macroBody("customUnInit"), /initInstallerLogging/);
});

test("installer tolerates legacy uninstaller failures so updates can continue", () => {
  assert.match(installerScript, /customUnInstallCheck/);
  assert.match(installerScript, /customUnInstallCheckCurrentUser/);
  assert.match(macroBody("customUnInstallCheck"), /Legacy uninstaller failed/);
  assert.match(macroBody("customUnInstallCheck"), /ClearErrors/);
  assert.match(macroBody("customUnInstallCheck"), /StrCpy \$R0 0/);
  assert.match(macroBody("customUnInstallCheckCurrentUser"), /customUnInstallCheck/);
});

test("installer logs processes that still reference the install directory", () => {
  const body = macroBody("logInstallDirProcesses");
  // Same Get-Process refactor as closeInstallDirProcesses — the diagnostic
  // variant selects Id,Name,Path into the installer log without killing.
  assert.match(body, /Get-Process/);
  assert.match(body, /Path/);
  assert.match(body, /Out-File/);
});
