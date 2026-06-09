@echo off
rem Convenience wrapper. Calls status.ps1.
setlocal
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%status.ps1" %*
endlocal
