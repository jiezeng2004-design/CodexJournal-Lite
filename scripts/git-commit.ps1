# scripts/git-commit.ps1
# Runs `git add` + `git commit` strictly inside this project's directory.
# Does NOT push, does NOT delete files, does NOT modify git config.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\git-commit.ps1                  -> default message
#   powershell -ExecutionPolicy Bypass -File scripts\git-commit.ps1 -Message "..."    -> custom message
#   powershell -ExecutionPolicy Bypass -File scripts\git-commit.ps1 -AllowEmpty      -> allow empty commit
#   powershell -ExecutionPolicy Bypass -File scripts\git-commit.ps1 -AllowUnsafeParentRepo
#       -> ONLY use this if you really intend to commit to a parent git repo.
#          Without this flag the script REFUSES to run when the current
#          directory is not the git repository root, to avoid accidentally
#          staging unrelated untracked files from a parent workspace.
#
# Why the safety check?
#   If this project directory sits inside a larger parent git repository,
#   `git add -A` from here could stage unrelated untracked files from that
#   parent workspace. So we default to strict path-scoped behavior.

[CmdletBinding()]
param(
    [string]$Message = 'Update Codex journal',
    [switch]$AllowEmpty,
    [switch]$AllowUnsafeParentRepo,
    [switch]$NoAdd,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir '..')
Set-Location -LiteralPath $ProjectRoot

function Normalize-Path([string]$p) {
    if ([string]::IsNullOrEmpty($p)) { return $p }
    # Convert forward slashes to backslashes (git reports Windows paths with /).
    $p = $p.Replace('/', '\')
    $trimmed = $p.TrimEnd('\', '/')
    if ($trimmed.Length -eq 2 -and $trimmed[1] -eq ':') { return $trimmed }
    return $trimmed
}

$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if ($null -eq $gitCmd) {
    Write-Host "ERROR: git not found in PATH." -ForegroundColor Red
    exit 2
}

# Is this directory itself a git repository? (not just a subdir of one)
# We use `git rev-parse --show-cdup`: when the current directory IS the
# repo root it prints an empty string; otherwise it prints the relative
# path back up to the root (e.g. "../.."). This avoids the encoding
# issues that affect `--show-toplevel` when the project lives under a
# non-ASCII Windows username (PowerShell's console codepage can mangle
# non-ASCII characters in git's stdout, which would break a string
# equality check on the toplevel path).
$showCdup = $null
$showToplevel = $null
try {
    $showCdup = (& git rev-parse --show-cdup 2>$null)
    $showToplevel = (& git rev-parse --show-toplevel 2>$null)
} catch {}

if ($LASTEXITCODE -ne 0 -and $null -ne $showCdup) {
    Write-Host "ERROR: not a git repository: $ProjectRoot" -ForegroundColor Red
    Write-Host "Run 'git init' inside this directory first." -ForegroundColor Yellow
    exit 3
}

$isRepoHere = ($null -ne $showCdup) -and ([string]::IsNullOrEmpty($showCdup.Trim()))

$projectRootN = Normalize-Path $ProjectRoot.Path
$toplevelN    = if ($null -ne $showToplevel) { Normalize-Path $showToplevel } else { '' }

if (-not $isRepoHere) {
    $toplevelDisplay = if ([string]::IsNullOrEmpty($toplevelN)) { '(none found in parents)' } else { $toplevelN }
    if (-not $AllowUnsafeParentRepo) {
        Write-Host "ERROR: refusing to commit." -ForegroundColor Red
        Write-Host "  This project lives at:           $projectRootN" -ForegroundColor Red
        Write-Host "  Enclosing git repo root is at:   $toplevelDisplay" -ForegroundColor Red
        Write-Host ""
        Write-Host "  Running 'git add' here would also stage unrelated untracked files" -ForegroundColor Red
        Write-Host "  from the parent workspace. To avoid that, this script defaults to" -ForegroundColor Red
        Write-Host "  refusing to run unless this directory is itself a git repo root." -ForegroundColor Red
        Write-Host ""
        if ([string]::IsNullOrEmpty($toplevelN)) {
            Write-Host "Suggested fix:" -ForegroundColor Yellow
            Write-Host "  Initialize a project-local git repo in this directory:" -ForegroundColor Yellow
            Write-Host "       cd `"$projectRootN`"" -ForegroundColor Yellow
            Write-Host "       git init" -ForegroundColor Yellow
            Write-Host "       git add ." -ForegroundColor Yellow
            Write-Host "       git commit -m `"initial commit`"" -ForegroundColor Yellow
            Write-Host "       ...then re-run this script." -ForegroundColor Yellow
        } else {
            Write-Host "Two safe options:" -ForegroundColor Yellow
            Write-Host "  1. Initialize a project-local git repo:" -ForegroundColor Yellow
            Write-Host "       cd `"$projectRootN`"" -ForegroundColor Yellow
            Write-Host "       git init" -ForegroundColor Yellow
            Write-Host "       git add ." -ForegroundColor Yellow
            Write-Host "       git commit -m `"initial commit`"" -ForegroundColor Yellow
            Write-Host "       ...then re-run this script." -ForegroundColor Yellow
            Write-Host "  2. Re-run this script with -AllowUnsafeParentRepo" -ForegroundColor Yellow
            Write-Host "     ONLY if you really intend to commit to the parent repo." -ForegroundColor Yellow
        }
        exit 4
    } else {
        Write-Host "WARNING: -AllowUnsafeParentRepo is set. Will operate against the parent repo at:" -ForegroundColor Yellow
        Write-Host "  $toplevelDisplay" -ForegroundColor Yellow
        Write-Host "Continuing in 3 seconds... (Ctrl+C to abort)" -ForegroundColor Yellow
        Start-Sleep -Seconds 3
    }
}

if (-not $NoAdd) {
    # Use `git add -- .` so we never accidentally interpret a pathspec as
    # a branch name, and we only stage the current directory (and below).
    Write-Host "[git-commit] staging files under: $projectRootN"
    if ($DryRun) {
        Write-Host "[git-commit] (dry-run) would run: git add -- ." -ForegroundColor Cyan
        $status = (& git status --porcelain 2>$null)
        if ($status) {
            Write-Host "Files that would be staged:" -ForegroundColor Cyan
            foreach ($line in $status) { Write-Host "  $line" -ForegroundColor Cyan }
        } else {
            Write-Host "(nothing to stage)" -ForegroundColor Cyan
        }
    } else {
        & git add -- .
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: git add failed." -ForegroundColor Red
            exit $LASTEXITCODE
        }
    }
}

if ($DryRun) {
    Write-Host "[git-commit] (dry-run) would run: git commit -m `"$Message`"" -ForegroundColor Cyan
    Write-Host "[git-commit] no push performed."
    exit 0
}

$hasStaged = (& git diff --cached --name-only 2>$null)
if (-not $hasStaged -and -not $AllowEmpty) {
    Write-Host "Nothing staged. Nothing to commit. (Use -AllowEmpty to force an empty commit.)" -ForegroundColor Yellow
    exit 0
}

Write-Host "[git-commit] git commit -m `"$Message`""
& git commit -m "$Message"
$code = $LASTEXITCODE
if ($code -ne 0) {
    Write-Host "git commit exited with code $code" -ForegroundColor Yellow
    exit $code
}

Write-Host "[git-commit] done. (no push performed)"
exit 0
