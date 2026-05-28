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
  assert.doesNotMatch(closeOne, /nsProcess::_FindProcess/);
  assert.match(macroBody("closeInstallDirProcesses"), /Get-CimInstance Win32_Process/);
  assert.match(macroBody("closeInstallDirProcesses"), /Stop-Process/);
  assert.match(macroBody("closeInstallDirProcesses"), /\$\$_\.ExecutablePath/);
  assert.match(macroBody("customCheckAppRunning"), /closeAppProcesses/);
  assert.match(macroBody("customInit"), /closeAppProcesses/);
  assert.match(macroBody("customInstall"), /closeAppProcesses/);
});

test("installer closes current and legacy app processes before uninstall", () => {
  assert.match(macroBody("closeAppProcesses"), /PipeAgent\.exe/);
  assert.match(macroBody("customUnInit"), /closeAppProcesses/);
  assert.match(macroBody("customUnInstall"), /closeAppProcesses/);
});
