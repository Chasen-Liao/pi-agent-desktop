; Pi Agent Desktop — custom NSIS installer script
; Forcefully kills running app process before install/uninstall.
; This ensures files are not locked when the installer tries to overwrite them.

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
    nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "Add-Content -LiteralPath \"${PI_AGENT_INSTALLER_LOG_FILE}\" -Value \"Processes running from install dir: $INSTDIR\"; Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith(\"$INSTDIR\", [System.StringComparison]::OrdinalIgnoreCase) } | Select-Object ProcessId,Name,ExecutablePath,CommandLine | Out-File -LiteralPath \"${PI_AGENT_INSTALLER_LOG_FILE}\" -Append -Width 4096"'
    Pop $R0
    !insertmacro appendInstallerLog "logInstallDirProcesses returned $R0"
  ${EndIf}
!macroend

!macro closeAppProcess PROCESS_NAME DISPLAY_NAME
  !insertmacro appendInstallerLog "Closing ${DISPLAY_NAME} process ${PROCESS_NAME}"
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${PROCESS_NAME}"'
  Pop $R0
  !insertmacro appendInstallerLog "taskkill ${PROCESS_NAME} returned $R0"
  Sleep 1000
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
    !insertmacro logInstallDirProcesses
    nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { ($$_.ExecutablePath -and $$_.ExecutablePath.StartsWith(\"$INSTDIR\", [System.StringComparison]::OrdinalIgnoreCase)) -or ($$_.Name -in @(\"Pi Agent Desktop.exe\", \"Pi Agent.exe\", \"PipeAgent.exe\") -and $$_.CommandLine -and $$_.CommandLine.IndexOf(\"$INSTDIR\", [System.StringComparison]::OrdinalIgnoreCase) -ge 0) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
    Pop $R0
    !insertmacro appendInstallerLog "closeInstallDirProcesses returned $R0"
    Sleep 2000
    !insertmacro logInstallDirProcesses
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
