@echo off
rem Convenience wrapper. Calls the PowerShell scripts which actually do
rem the work. This is the file users will double-click.
rem
rem Usage:   console\start.cmd             (default port 7777)
rem          PORT=8888 console\start.cmd

setlocal
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start.ps1" %*
endlocal
