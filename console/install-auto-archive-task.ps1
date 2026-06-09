# console/install-auto-archive-task.ps1
# Registers a Windows Task Scheduler job that runs `console/auto-archive.ps1` daily at 23:55.
# This is a one-shot installer. It does NOT push to git, does NOT delete anything.
#
# Usage (run in elevated PowerShell):
#   powershell -NoProfile -ExecutionPolicy Bypass -File console\install-auto-archive-task.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File console\install-auto-archive-task.ps1 -Time '23:30'
#   powershell -NoProfile -ExecutionPolicy Bypass -File console\install-auto-archive-task.ps1 -TaskName 'MyName'
#
# To remove:
#   Unregister-ScheduledTask -TaskName 'CodexJournal-Lite Auto-Archive' -Confirm:$false

[CmdletBinding()]
param(
    [string]$Time = '23:55',
    [string]$TaskName = 'CodexJournal-Lite Auto-Archive'
)

$ErrorActionPreference = 'Stop'

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir '..')
$RunScript   = Join-Path $ScriptDir 'auto-archive.ps1'

if (-not (Test-Path -LiteralPath $RunScript)) {
    Write-Host "ERROR: auto-archive.ps1 not found at $RunScript" -ForegroundColor Red
    exit 2
}

$psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $psExe)) {
    Write-Host "ERROR: cannot locate powershell.exe at $psExe" -ForegroundColor Red
    exit 2
}

# Idempotent: remove existing task with the same name first
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
        -Description "Daily auto-archive of Codex sessions in CodexJournal-Lite. Runs console/auto-archive.ps1 at $Time. On any failure, pops a Windows toast. Local-only; no upload; no file deletion." `
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
Write-Host "Log goes to:  $ProjectRoot\reports\auto-archive.log"
Write-Host "On failure, a Windows toast will pop up. On success, the script is silent."
