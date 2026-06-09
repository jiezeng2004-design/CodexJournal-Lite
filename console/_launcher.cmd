@echo off
rem Internal launcher used by start.cmd. Do not run directly.
setlocal
cd /d "%~dp0\.."
if not "%PORT%"=="" goto :have_port
set "PORT=7777"
:have_port
call npm.cmd run console
endlocal
