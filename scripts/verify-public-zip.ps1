# scripts/verify-public-zip.ps1
#
# Validates a public release ZIP archive for CodexJournal-Lite.
# Checks: file existence, POSIX paths, required files present,
# forbidden entries absent, and no backslash paths.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/verify-public-zip.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/verify-public-zip.ps1 -ZipPath "dist/CodexJournal-Lite-v0.6.2-public.zip"

[CmdletBinding()]
param(
    [string]$ZipPath = ""
)

$ErrorActionPreference = 'Stop'
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir '..')
$distDir     = Join-Path $projectRoot 'dist'

if ([string]::IsNullOrWhiteSpace($ZipPath)) {
    $pkg = Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
    $version = $pkg.version
    $zipName = "CodexJournal-Lite-v$version-public.zip"
    $ZipPath = Join-Path $distDir $zipName
} else {
    $ZipPath = Resolve-Path -LiteralPath $ZipPath -ErrorAction SilentlyContinue
}

$passed = 0
$failed = 0
$failures = @()

function check($label, $cond, $detail) {
    if ($cond) {
        $global:passed += 1
        Write-Host "[verify-public-zip] OK: $label"
    } else {
        $global:failed += 1
        $global:failures += "$label :: $detail"
        Write-Host "[verify-public-zip] FAIL: $label" -ForegroundColor Red
        if ($detail) { Write-Host "  $detail" -ForegroundColor Red }
    }
}

try {
    Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
} catch {
    Write-Host "[verify-public-zip] ERROR: could not load System.IO.Compression: $($_.Exception.Message)" -ForegroundColor Red
    exit 7
}

# 1. ZIP exists
check 'zip exists' (Test-Path -LiteralPath $ZipPath) "expected: $ZipPath"
if (-not (Test-Path -LiteralPath $ZipPath)) {
    Write-Host "[verify-public-zip] done (early exit -- zip not found)" -ForegroundColor Red
    exit 1
}

# Open the zip
$fs = [System.IO.File]::OpenRead($ZipPath)
$za = [System.IO.Compression.ZipArchive]::new($fs)

$entryNames = New-Object 'System.Collections.Generic.HashSet[string]'
$allEntries = @()
$backslashEntries = @()

foreach ($entry in $za.Entries) {
    $name = $entry.FullName
    $allEntries += $name
    [void]$entryNames.Add($name)
    if ($name -match '\\') { $backslashEntries += $name }
}

# 2. No backslash paths
$backslashDetail = if ($backslashEntries.Count -gt 0) { "backslash entries: $($backslashEntries -join ', ')" } else { '' }
check 'no backslash paths' ($backslashEntries.Count -eq 0) $backslashDetail

# 3. Required files present
$required = @(
    'src/index.js',
    'package.json',
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
    'SECURITY.md',
    'CONTRIBUTING.md',
    'config.json',
    '.github/workflows/ci.yml',
    'scripts/package-public.ps1',
    'scripts/verify-public-zip.ps1',
    'docs/privacy.md',
    'console/server.js',
    'data/README.md',
    'journal/README.md',
    'reports/README.md'
)
foreach ($req in $required) {
    check "required file present: $req" ($entryNames.Contains($req)) ''
}

# 4. Forbidden entries absent
$forbidden = @(
    '.git/',
    'node_modules/',
    '.env'
)
$foundForbidden = @()
foreach ($name in $allEntries) {
    $n = $name -replace '\\', '/'

    # Whitelist: committed placeholders
    if ($n -match '(^|/)(data|journal|reports|dist)/\.gitkeep$') { continue }
    if ($n -match '(^|/)(data|journal|reports)/README\.md$') { continue }
    if ($n -match '(^|/)test-fixtures/') { continue }

    if ($n -match '(^|/)\.git/') { $foundForbidden += $n }
    elseif ($n -match '(^|/)node_modules/') { $foundForbidden += $n }
    elseif ($n -match '(^|/)\.env($|\.)') { $foundForbidden += $n }
    elseif ($n -match 'data/tasks\.json$') { $foundForbidden += $n }
    elseif ($n -match 'data/search\.md$') { $foundForbidden += $n }
    elseif ($n -match 'data/stats\.json$') { $foundForbidden += $n }
    elseif ($n -match 'data/patterns\.json$') { $foundForbidden += $n }
    elseif ($n -match 'data/index\.json$') { $foundForbidden += $n }
    elseif ($n -match 'journal/[^/]+\.md$') { $foundForbidden += $n }
    elseif ($n -match 'reports/dashboard\.md$') { $foundForbidden += $n }
    elseif ($n -match 'reports/work-patterns\.md$') { $foundForbidden += $n }
    elseif ($n -match 'reports/output-index\.(md|json)$') { $foundForbidden += $n }
    elseif ($n -match 'reports/doctor\.md$') { $foundForbidden += $n }
    elseif ($n -match 'reports/[^/]+\.json$') { $foundForbidden += $n }
    elseif ($n -match 'reports/monthly/') { $foundForbidden += $n }
    elseif ($n -match 'reports/yearly/') { $foundForbidden += $n }
    elseif ($n -match 'reports/errors\.log$') { $foundForbidden += $n }
    elseif ($n -match 'reports/\.tmp/') { $foundForbidden += $n }
    elseif ($n -match 'dist/.*\.zip$') { $foundForbidden += $n }
    elseif ($n -match '\-local\.zip$') { $foundForbidden += $n }
    elseif ($n -match 'CodexJournal-Lite-publish\.zip$') { $foundForbidden += $n }
}

$forbiddenDetail = if ($foundForbidden.Count -gt 0) { "forbidden: $($foundForbidden -join ', ')" } else { '' }
check 'no forbidden entries' ($foundForbidden.Count -eq 0) $forbiddenDetail

$za.Dispose()
$fs.Close()

# Summary
Write-Host ""
if ($failed -eq 0) {
    Write-Host "[verify-public-zip] passed: $passed, failed: $failed"
    Write-Host "[verify-public-zip] done"
    exit 0
} else {
    Write-Host "[verify-public-zip] passed: $passed, failed: $failed" -ForegroundColor Red
    Write-Host "[verify-public-zip] FAILURES:" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host "  - $f" -ForegroundColor Red }
    exit 1
}
