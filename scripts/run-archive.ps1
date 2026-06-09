# scripts/run-archive.ps1
# Enters the project root and runs `npm run archive`.
# Intended to be the Program action of the scheduled task.
# No destructive operations.

$ErrorActionPreference = 'Stop'

# Resolve the project root from this script's location: scripts/.. -> project root.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir '..')

Set-Location -LiteralPath $ProjectRoot

# Pick npm.cmd first (avoids PowerShell .ps1 shim confusion on Windows).
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $npmCmd) {
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
}
if ($null -eq $npmCmd) {
    Write-Host "ERROR: npm / npm.cmd not found in PATH." -ForegroundColor Red
    exit 2
}

Write-Host "[run-archive] cwd = $ProjectRoot"
Write-Host "[run-archive] starting: npm run archive"

& $npmCmd.Path run archive
$code = $LASTEXITCODE
if ($code -ne 0) {
    Write-Host "[run-archive] npm run archive exited with code $code" -ForegroundColor Yellow
}
exit $code
