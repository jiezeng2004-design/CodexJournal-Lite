# Console stop script for CodexJournal-Lite (Windows).
# Kills whatever is bound to the console port (default 7777), using
# taskkill /T to also kill child processes.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File console\stop.ps1
#         $env:PORT=8888; powershell -NoProfile -ExecutionPolicy Bypass -File console\stop.ps1

param([int]$Port = 0)

$ErrorActionPreference = 'SilentlyContinue'
if ($Port -eq 0) {
    if ($env:PORT) { $Port = [int]$env:PORT } else { $Port = 7777 }
}

Write-Host "[console] looking for listeners on port $Port ..."
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) {
  Write-Host "[console] no listener on port $Port. nothing to do."
  exit 0
}
foreach ($c in $conns) {
  $ownerPid = $c.OwningProcess
  $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
  Write-Host "[console] killing pid $ownerPid ($($proc.ProcessName)) and children ..."
  # taskkill /T /F walks the process tree, which is the only way to reach
  # the actual node.exe when its parent is a Start-Process wrapper.
  & taskkill.exe /F /T /PID $ownerPid 2>&1 | Out-Null
}
Write-Host "[console] done."
