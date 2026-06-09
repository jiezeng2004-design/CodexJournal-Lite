# Console status script for CodexJournal-Lite (Windows).
# Reports whether anything is listening on the console port.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File console\status.ps1
#         $env:PORT=8888; powershell -NoProfile -ExecutionPolicy Bypass -File console\status.ps1

param([int]$Port = 0)

$ErrorActionPreference = 'SilentlyContinue'
if ($Port -eq 0) {
    if ($env:PORT) { $Port = [int]$env:PORT } else { $Port = 7777 }
}

Write-Host "[console] checking port $Port ..."
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conns) {
  foreach ($c in $conns) {
    $ownerPid = $c.OwningProcess
    Write-Host "[console] listening: pid $ownerPid  url=http://127.0.0.1:$Port/"
  }
  exit 0
}
Write-Host "[console] not running on port $Port."
Write-Host "[console] start with: powershell -NoProfile -ExecutionPolicy Bypass -File console\start.ps1"
exit 1
