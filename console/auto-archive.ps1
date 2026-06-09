# console/auto-archive.ps1
# Three-step daily auto-archive: archive -> summarize -> verify.
# Designed to be invoked by a Windows Task Scheduler job at 23:55 local time.
#
# Behavior:
#   1. Runs `npm.cmd run archive -- --force` (re-parse .codex sessions).
#   2. Runs `npm.cmd run summarize` (regenerate monthly / yearly / work-patterns reports).
#   3. Runs `npm.cmd run verify -SkipArchive` (fast verify, A-M, no re-archive).
#   4. On any non-zero exit, pops a Windows toast notification. On success, silent.
#   5. Writes its own log to `reports/auto-archive.log`.
#
# Does NOT register the scheduled task. Run `install-auto-archive-task.ps1`
# (or the schtasks command printed at the bottom) to do that manually.
#
# No destructive operations. Does not touch .codex sessions. Does not push to git.

[CmdletBinding()]
param(
    [string]$Time = '23:55',
    [string]$TaskName = 'CodexJournal-Lite Auto-Archive',
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'   # we want to capture exit codes, not throw

# ---------------------------------------------------------------------------
# Resolve project root: console/..  ->  project root
# ---------------------------------------------------------------------------
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir '..')
$LogDir     = Join-Path $ProjectRoot 'reports'
$LogFile    = Join-Path $LogDir 'auto-archive.log'

# Ensure log directory exists
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
}

function Write-Log {
    param([string]$Line, [string]$Level = 'INFO')
    $ts   = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
    $line = "[$ts] [$Level] $Line"
    Add-Content -LiteralPath $LogFile -Value $line -Encoding utf8
    switch ($Level) {
        'WARN'  { Write-Host $line -ForegroundColor Yellow }
        'ERROR' { Write-Host $line -ForegroundColor Red }
        default { Write-Host $line }
    }
}

# ---------------------------------------------------------------------------
# Pick npm.cmd
# ---------------------------------------------------------------------------
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $npmCmd) { $npmCmd = Get-Command npm -ErrorAction SilentlyContinue }
if ($null -eq $npmCmd) {
    Write-Log "npm / npm.cmd not found in PATH" 'ERROR'
    Show-Toast -Title 'CodexJournal-Lite 归档失败' -Body '找不到 npm.cmd，请检查 PATH'
    exit 2
}

# ---------------------------------------------------------------------------
# Toast helper (BurntToast > Windows.Forms.NotifyIcon > msg.exe fallback)
# ---------------------------------------------------------------------------
function Show-Toast {
    param([string]$Title, [string]$Body)
    try {
        if (Get-Module -ListAvailable -Name BurntToast) {
            Import-Module BurntToast -ErrorAction SilentlyContinue
            if (Get-Command New-BurntToastNotification -ErrorAction SilentlyContinue) {
                New-BurntToastNotification -Text $Title, $Body | Out-Null
                return
            }
        }
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        if ([System.Windows.Forms.NotifyIcon] -ne $null) {
            $n = New-Object System.Windows.Forms.NotifyIcon
            $n.Icon = [System.Drawing.SystemIcons]::Warning
            $n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
            $n.BalloonTipTitle = $Title
            $n.BalloonTipText = $Body
            $n.Visible = $true
            $n.ShowBalloonTip(8000)
            Start-Sleep -Milliseconds 50
            $n.Dispose()
            return
        }
    } catch { /* fall through */ }
    # Final fallback: msg.exe (works on Windows 10+)
    try { & msg.exe * "$Title - $Body" 2>$null } catch { }
}

# ---------------------------------------------------------------------------
# Run one step
# ---------------------------------------------------------------------------
function Run-Step {
    param(
        [string]$Label,
        [string[]]$NpmArgs
    )
    Write-Log "step start: $Label  ($($NpmArgs -join ' '))"
    if ($DryRun) {
        Write-Log "step dry-run: skipping"
        return 0
    }
    Push-Location -LiteralPath $ProjectRoot
    try {
        & $npmCmd.Path @NpmArgs 2>&1 | ForEach-Object { Write-Log "  $_" }
    } finally {
        Pop-Location
    }
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Write-Log "step failed: $Label  exit=$code" 'ERROR'
    } else {
        Write-Log "step ok: $Label"
    }
    return $code
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
$startTime = Get-Date
Write-Log "================ auto-archive start ================"
Write-Log "project: $ProjectRoot"

$step1 = Run-Step -Label 'archive'      -NpmArgs @('run', 'archive', '--', '--force')
$step2 = Run-Step -Label 'summarize'    -NpmArgs @('run', 'summarize')
$step3 = Run-Step -Label 'verify-skip'  -NpmArgs @('run', 'verify', '--', '-SkipArchive')

$elapsed = (Get-Date) - $startTime
Write-Log "elapsed: $($elapsed.TotalSeconds.ToString('0.0'))s"

if ($step1 -ne 0 -or $step2 -ne 0 -or $step3 -ne 0) {
    $failed = @()
    if ($step1 -ne 0) { $failed += "archive=$step1" }
    if ($step2 -ne 0) { $failed += "summarize=$step2" }
    if ($step3 -ne 0) { $failed += "verify=$step3" }
    $failList = $failed -join ', '
    Write-Log "auto-archive FAILED: $failList" 'ERROR'
    Show-Toast -Title 'CodexJournal-Lite 自动归档失败' -Body "失败步骤: $failList · 查看 reports\auto-archive.log"
    exit 1
}

Write-Log "auto-archive OK"
Write-Log "================ auto-archive end ================"
exit 0
