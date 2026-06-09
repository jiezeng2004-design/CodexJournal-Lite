# Console start script for CodexJournal-Lite (Windows).
# Spawns the local web console as a detached background process.
# Closing this shell does NOT kill the server.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File console\start.ps1
#         $env:PORT=8888; powershell -NoProfile -ExecutionPolicy Bypass -File console\start.ps1

param([int]$Port = 0)

$ErrorActionPreference = 'Stop'
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir '..')
$Launcher    = Join-Path $ScriptDir '_launcher.cmd'

if ($Port -eq 0) {
    if ($env:PORT) { $Port = [int]$env:PORT } else { $Port = 7777 }
}

# Refuse to start a second instance.
$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  $pidOwner = (Get-Process -Id $existing[0].OwningProcess -ErrorAction SilentlyContinue).Id
  Write-Host "[console] port $Port already in use (pid $pidOwner). already running."
  Write-Host "[console] run console\stop.ps1 to stop."
  exit 0
}

# Detach a new PowerShell that runs the launcher in its own window.
# We use a fresh PowerShell (not cmd.exe) because PowerShell can pass
# arguments cleanly without shell-quote hell, and Start-Process from
# PowerShell reliably detaches the child.
$logFile = Join-Path $ProjectRoot 'reports\console-stdout.log'
$errFile = $logFile + '.err'
if (Test-Path -LiteralPath $logFile) { Remove-Item -LiteralPath $logFile -Force }
if (Test-Path -LiteralPath $errFile) { Remove-Item -LiteralPath $errFile -Force }

$env:PORT = $Port
# Use -Command with the launcher path. Start-Process of powershell.exe
# with -WindowStyle Hidden reliably detaches in Windows.
$psArgs = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-Command', "& { & '$Launcher' *>&1 | Tee-Object -FilePath '$logFile' }"
)
Start-Process -FilePath 'powershell.exe' -ArgumentList $psArgs -WindowStyle Hidden | Out-Null

Write-Host "[console] starting on http://127.0.0.1:$Port/"
Write-Host "[console] log: $logFile"
Write-Host "[console] stop: console\stop.ps1"

# Wait up to 10s for the port.
$waited = 0
while ($waited -lt 10) {
  Start-Sleep -Seconds 1
  $waited++
  $ready = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($ready) {
    Write-Host "[console] ready after ${waited}s."
    exit 0
  }
}
Write-Host "[console] timeout waiting for port $Port. check the log:"
Write-Host "[console]   $logFile"
exit 1
