; Pi Agent Desktop — custom NSIS installer script
; Forcefully kills running app process before install/uninstall
; This ensures files are not locked when the installer tries to overwrite them.

!macro customInstall
  nsProcess::_FindProcess "Pi Agent Desktop.exe"
  Pop $R0
  ${If} $R0 = 0
    DetailPrint "Closing running Pi Agent Desktop..."
    nsProcess::_KillProcess "Pi Agent Desktop.exe"
    Pop $R0
    Sleep 2000
  ${EndIf}
!macroend

!macro customUnInstall
  nsProcess::_FindProcess "Pi Agent Desktop.exe"
  Pop $R0
  ${If} $R0 = 0
    DetailPrint "Closing running Pi Agent Desktop..."
    nsProcess::_KillProcess "Pi Agent Desktop.exe"
    Pop $R0
    Sleep 2000
  ${EndIf}
!macroend
