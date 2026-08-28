; Pi Agent Desktop — custom NSIS installer script
; NOTE: this file MUST stay UTF-8 **with BOM** — makensis reads non-ASCII
; includes without a BOM in the system ANSI codepage (mojibake or
; "Bad text encoding" on zh-CN/GBK machines).
; Forcefully kills running app process before install/uninstall.
; This ensures files are not locked when the installer tries to overwrite them.

; Issue #19: on the directory page, switching to another drive (e.g. C: -> D:)
; shows only the drive root because the app subfolder does not exist there yet.
; electron-builder's stock template appends "${APP_FILENAME}" automatically at
; install time, but the user cannot see that and ends up typing the folder by
; hand — which can produce a nested folder (the check is case-sensitive).
; Hint on the page instead. Must be defined before MUI_PAGE_DIRECTORY is
; inserted; this file is included before the electron-builder template script.
!ifndef MUI_DIRECTORYPAGE_TEXT_TOP
  ; MUI2 wraps this value in quotes itself (DirText "${...}"), so the value
  ; must not contain double quotes.
  !define MUI_DIRECTORYPAGE_TEXT_TOP '提示：切换到其它盘符后，安装程序会自动在所选路径下创建 ${APP_FILENAME} 子文件夹，无需手动输入。 Tip: the ${APP_FILENAME} subfolder is created automatically under the chosen path — no need to type it.'
!endif

!define PI_AGENT_INSTALLER_LOG_DIR "$TEMP\Pi-Agent-Desktop"
!define PI_AGENT_INSTALLER_LOG_FILE "${PI_AGENT_INSTALLER_LOG_DIR}\installer.log"

!macro appendInstallerLog MESSAGE
  Push $R9
  CreateDirectory "${PI_AGENT_INSTALLER_LOG_DIR}"
  FileOpen $R9 "${PI_AGENT_INSTALLER_LOG_FILE}" a
  FileWrite $R9 "${MESSAGE}$\r$\n"
  FileClose $R9
  Pop $R9
!macroend

!macro initInstallerLogging
  Push $R9
  CreateDirectory "${PI_AGENT_INSTALLER_LOG_DIR}"
  FileOpen $R9 "${PI_AGENT_INSTALLER_LOG_FILE}" a
  FileWrite $R9 "$\r$\n=== ${PRODUCT_NAME} ${VERSION} installer ===$\r$\n"
  FileWrite $R9 "INSTDIR=$INSTDIR$\r$\n"
  FileWrite $R9 "CMDLINE=$CMDLINE$\r$\n"
  FileClose $R9
  Pop $R9
!macroend

!macro logInstallDirProcesses
  ${If} $INSTDIR != ""
    nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "Add-Content -LiteralPath \"${PI_AGENT_INSTALLER_LOG_FILE}\" -Value \"Processes running from install dir: $INSTDIR\"; Get-Process | Where-Object { $$_.Path -and $$_.Path.StartsWith(\"$INSTDIR\", [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object Id,Name,Path | Out-File -LiteralPath \"${PI_AGENT_INSTALLER_LOG_FILE}\" -Append -Width 4096"'
    Pop $R0
    !insertmacro appendInstallerLog "logInstallDirProcesses returned $R0"
  ${EndIf}
!macroend

!macro _isProcessRunning PROCESS_NAME RESULT_VAR
  ; RESULT_VAR = 1 if running, 0 if not. Uses tasklist /FO CSV /NH — matching
  ; rows are CSV (start with a quote), "INFO:" lines are plain text in every locale.
  nsExec::ExecToStack '"$SYSDIR\tasklist.exe" /FI "IMAGENAME eq ${PROCESS_NAME}" /FO CSV /NH'
  Pop $R7 ; exit code
  Pop $R8 ; stdout
  StrCpy ${RESULT_VAR} 0
  ${If} $R8 != ""
    ; If the first char is a double-quote, tasklist found a matching process (CSV row)
    StrCpy $R9 $R8 1
    ${If} $R9 == '"'
      StrCpy ${RESULT_VAR} 1
    ${EndIf}
  ${EndIf}
!macroend

!macro closeAppProcess PROCESS_NAME DISPLAY_NAME
  !insertmacro appendInstallerLog "Closing ${DISPLAY_NAME} process ${PROCESS_NAME}"
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${PROCESS_NAME}"'
  Pop $R0
  !insertmacro appendInstallerLog "taskkill ${PROCESS_NAME} returned $R0"
  ; Wait up to 8s, polling to confirm the process actually exited.
  ; taskkill /F /T is reliable but process teardown is async — verify with tasklist.
  ${For} $R2 1 8
    Sleep 1000
    !insertmacro _isProcessRunning "${PROCESS_NAME}" $R6
    ${If} $R6 == 0
      !insertmacro appendInstallerLog "${PROCESS_NAME} confirmed exited (attempt $R2)"
      ${Break}
    ${EndIf}
    !insertmacro appendInstallerLog "${PROCESS_NAME} still running after attempt $R2"
  ${Next}
!macroend

!macro closeAppProcesses
  !insertmacro appendInstallerLog "closeAppProcesses start"
  !insertmacro closeAppProcess "Pi Agent Desktop.exe" "Pi Agent Desktop"
  !insertmacro closeAppProcess "Pi Agent.exe" "Pi Agent"
  !insertmacro closeAppProcess "PipeAgent.exe" "PipeAgent"
  !insertmacro closeInstallDirProcesses
  !insertmacro appendInstallerLog "closeAppProcesses end"
!macroend

!macro closeInstallDirProcesses
  ${If} $INSTDIR != ""
    !insertmacro appendInstallerLog "Closing install-dir processes from $INSTDIR"
    ; Force kill nodes spawned from install dir — and the main apps by name in the install dir.
    ; Uses `Get-Process` (fast in-process) instead of `Get-CimInstance` (slow WMI round-trip).
    ; Merges logging + killing into one PS invocation to avoid paying the PS startup cost twice.
    nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$$logFile = \"${PI_AGENT_INSTALLER_LOG_FILE}\"; $$dir = \"$INSTDIR\"; $$targets = Get-Process | Where-Object { ($$_.Path -and $$_.Path.StartsWith($$dir, [System.StringComparison]::OrdinalIgnoreCase)) -or ($$_.Name -in @(\"Pi Agent Desktop\", \"Pi Agent\", \"PipeAgent\") -and $$_.CommandLine -and $$_.CommandLine.IndexOf($$dir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) }; Add-Content -LiteralPath $$logFile -Value \"Killing $$($$targets.Count) install-dir process(es)\"; $$targets | Select-Object Id,Name,Path | Out-File -LiteralPath $$logFile -Append -Width 4096; $$targets | ForEach-Object { Stop-Process -Id $$_.Id -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 1; $$remain = Get-Process | Where-Object { ($$_.Path -and $$_.Path.StartsWith($$dir, [System.StringComparison]::OrdinalIgnoreCase)) -or ($$_.Name -in @(\"Pi Agent Desktop\", \"Pi Agent\", \"PipeAgent\") -and $$_.CommandLine -and $$_.CommandLine.IndexOf($$dir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) }; Add-Content -LiteralPath $$logFile -Value \"After kill: $$($$remain.Count) process(es) still alive\""'
    Pop $R0
    !insertmacro appendInstallerLog "closeInstallDirProcesses returned $R0"
  ${EndIf}
!macroend

!macro customUnInstallCheck
  ${If} $R0 != 0
    !insertmacro appendInstallerLog "Legacy uninstaller failed with $R0; continuing install"
  ${EndIf}
  ClearErrors
  StrCpy $R0 0
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend

!macro customInit
  !insertmacro initInstallerLogging
  !insertmacro appendInstallerLog "customInit"
  !insertmacro closeAppProcesses
!macroend

!macro customCheckAppRunning
  !insertmacro appendInstallerLog "customCheckAppRunning"
  !insertmacro closeAppProcesses
!macroend

!macro customInstall
  !insertmacro appendInstallerLog "customInstall"
  !insertmacro closeAppProcesses
!macroend

!macro customUnInit
  !insertmacro initInstallerLogging
  !insertmacro appendInstallerLog "customUnInit"
  !insertmacro closeAppProcesses
!macroend

!macro customUnInstall
  !insertmacro appendInstallerLog "customUnInstall"
  !insertmacro closeAppProcesses
!macroend
