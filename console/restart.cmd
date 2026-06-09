@echo off
rem Convenience wrapper. Calls restart.ps1 (which calls stop then start).
setlocal
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%restart.ps1" %*
endlocal
