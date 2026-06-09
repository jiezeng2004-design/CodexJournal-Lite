# Console restart script for CodexJournal-Lite (Windows).
# Calls stop.ps1 then start.ps1.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File console\restart.ps1

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $ScriptDir 'stop.ps1') @args
& (Join-Path $ScriptDir 'start.ps1') @args
