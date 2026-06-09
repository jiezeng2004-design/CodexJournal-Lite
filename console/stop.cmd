@echo off
rem Convenience wrapper. Calls stop.ps1.
setlocal
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%stop.ps1" %*
endlocal
