; Pi Agent Desktop — custom NSIS installer script
; Forcefully kills running app process before install/uninstall.
; This ensures files are not locked when the installer tries to overwrite them.

!macro closeAppProcess PROCESS_NAME DISPLAY_NAME
  DetailPrint "Closing running ${DISPLAY_NAME}..."
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "${PROCESS_NAME}"'
  Pop $R0
  Sleep 1000
!macroend

!macro closeAppProcesses
  !insertmacro closeAppProcess "Pi Agent Desktop.exe" "Pi Agent Desktop"
  !insertmacro closeAppProcess "Pi Agent.exe" "Pi Agent"
  !insertmacro closeAppProcess "PipeAgent.exe" "PipeAgent"
  !insertmacro closeInstallDirProcesses
!macroend

!macro closeInstallDirProcesses
  ${If} $INSTDIR != ""
    DetailPrint "Closing processes running from $INSTDIR..."
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith(\"$INSTDIR\", [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
    Pop $R0
    Sleep 2000
  ${EndIf}
!macroend

!macro customInit
  !insertmacro closeAppProcesses
!macroend

!macro customCheckAppRunning
  !insertmacro closeAppProcesses
!macroend

!macro customInstall
  !insertmacro closeAppProcesses
!macroend

!macro customUnInit
  !insertmacro closeAppProcesses
!macroend

!macro customUnInstall
  !insertmacro closeAppProcesses
!macroend
