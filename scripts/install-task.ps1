# scripts/install-task.ps1
# Registers a Windows Task Scheduler job that runs `scripts/run-archive.ps1` daily.
# DOES NOT push to git, does NOT delete files.

[CmdletBinding()]
param(
    [string]$Time = '00:10',
    [string]$TaskName = 'CodexJournal-Lite Daily Archive'
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir '..')
$RunScript   = Join-Path $ScriptDir 'run-archive.ps1'

if (-not (Test-Path -LiteralPath $RunScript)) {
    Write-Host "ERROR: run-archive.ps1 not found at $RunScript" -ForegroundColor Red
    exit 2
}

# Verify PowerShell.exe path (the one actually on disk, not the AppX stub if present).
$psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $psExe)) {
    Write-Host "ERROR: cannot locate powershell.exe at $psExe" -ForegroundColor Red
    exit 2
}

# If a task with this name already exists, remove it first so we get a clean registration.
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Existing task '$TaskName' found. Removing it before re-creating."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false | Out-Null
}

$action = New-ScheduledTaskAction `
    -Execute $psExe `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RunScript`"" `
    -WorkingDirectory $ProjectRoot

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType S4U `
    -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -AllowStartIfOnBatteries

try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings `
        -Description "Daily archive of Codex sessions into CodexJournal-Lite journal/, data/, reports/. Runs `npm run archive` via scripts/run-archive.ps1. Local-only; no upload; no file deletion." `
        | Out-Null
}
catch {
    Write-Host "ERROR: failed to register scheduled task: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Try running this script in an elevated (Administrator) PowerShell." -ForegroundColor Yellow
    exit 3
}

Write-Host ""
Write-Host "Scheduled task created." -ForegroundColor Green
Write-Host "  Name:        $TaskName"
Write-Host "  Schedule:    daily at $Time"
Write-Host "  Action:      $psExe -NoProfile -ExecutionPolicy Bypass -File `"$RunScript`""
Write-Host "  Working dir: $ProjectRoot"
Write-Host ""
Write-Host "How to inspect / manage it:"
Write-Host "  - GUI:    taskschd.msc   (look in Task Scheduler Library)"
Write-Host "  - List:   Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "  - Run now: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  - Disable: Disable-ScheduledTask -TaskName '$TaskName'"
Write-Host "  - Remove:  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
Write-Host ""
Write-Host "Logs go to:  $ProjectRoot\reports\errors.log"
Write-Host "Journal goes to: $ProjectRoot\journal\YYYY-MM-DD.md"
