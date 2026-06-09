# scripts/package-local.ps1
#
# Creates dist/CodexJournal-Lite-v<package-version>-local.zip containing the
# project files needed for a local handoff. Generated local outputs are included
# only when they already exist; cache, secrets, and prior zip artifacts are
# excluded.
#
# Stability:
#   - Uses .NET ZipArchive instead of Compress-Archive so every entry name is
#     an explicit project-relative POSIX path (src/index.js), never a Windows
#     path (src\index.js).
#   - Retries on file-locks with backoff.
#
# Hard rules:
#   - Never deletes any file outside dist/.
#   - Never runs git add / commit / push.
#   - Never touches .codex/sessions or any JetBrains log.
#   - Never sends data over the network.

[CmdletBinding()]
param(
    [string]$Version = ''
)

$ErrorActionPreference = 'Stop'

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir '..')
$DistDir     = Join-Path $ProjectRoot 'dist'

if ([string]::IsNullOrWhiteSpace($Version)) {
    $PackageJson = Join-Path $ProjectRoot 'package.json'
    try {
        $Version = (Get-Content -LiteralPath $PackageJson -Raw | ConvertFrom-Json).version
    } catch {
        Write-Host "ERROR: could not read version from package.json: $($_.Exception.Message)" -ForegroundColor Red
        exit 6
    }
}

try {
    Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
} catch {
    Write-Host "ERROR: could not load System.IO.Compression.FileSystem: $($_.Exception.Message)" -ForegroundColor Red
    exit 7
}

if (-not (Test-Path -LiteralPath $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
}

$zipName = "CodexJournal-Lite-v$Version-local.zip"
$zipPath = Join-Path $DistDir $zipName

Write-Host "[package-local] Creating: $zipPath"

$projectRootPath = $ProjectRoot.Path.TrimEnd('\', '/')
$includedEntries = New-Object 'System.Collections.Generic.HashSet[string]'
$tempZipPath = $null

function ConvertTo-ZipEntryName([string]$FullName) {
    $resolved = (Resolve-Path -LiteralPath $FullName).Path
    if (-not $resolved.StartsWith($projectRootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to package file outside project root: $resolved"
    }
    return $resolved.Substring($projectRootPath.Length).TrimStart('\', '/') -replace '\\', '/'
}

function Test-ZipExcluded([string]$EntryName) {
    if ($EntryName -match '(^|/)node_modules/') { return $true }
    if ($EntryName -match '(^|/)\.git/') { return $true }
    if ($EntryName -match '(^|/)\.env($|\.)') { return $true }
    if ($EntryName -match '(^|/)data/index\.json$') { return $true }
    if ($EntryName -match '(^|/)reports/errors\.log$') { return $true }
    if ($EntryName -match '(^|/)reports/\.tmp/') { return $true }
    if ($EntryName -match '(^|/)dist/.*\.zip$') { return $true }
    return $false
}

function Add-ZipFile([System.IO.Compression.ZipArchive]$Zip, [string]$FilePath) {
    $entryName = ConvertTo-ZipEntryName $FilePath
    if (Test-ZipExcluded $entryName) { return }
    if (-not $includedEntries.Add($entryName)) { return }

    $entry = $Zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    $fileStream = [System.IO.File]::OpenRead($FilePath)
    try {
        $fileStream.CopyTo($entryStream)
    } finally {
        $fileStream.Dispose()
        $entryStream.Dispose()
    }
}

function Add-ZipPath([System.IO.Compression.ZipArchive]$Zip, [string]$RelativePath) {
    $full = Join-Path $ProjectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $full)) { return }

    $item = Get-Item -LiteralPath $full
    if ($item.PSIsContainer) {
        Get-ChildItem -LiteralPath $item.FullName -Recurse -File -Force |
            ForEach-Object { Add-ZipFile $Zip $_.FullName }
    } else {
        Add-ZipFile $Zip $item.FullName
    }
}

# Public project files plus generated local outputs when they exist.
# Generated outputs remain gitignored; this zip is a local handoff artifact.
$items = @(
    'src',
    'scripts',
    'docs',
    'console',
    'test-fixtures',
    'config.json',
    'package.json',
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
    'SECURITY.md',
    'CONTRIBUTING.md',
    '.gitignore',
    'data/.gitkeep',
    'data/README.md',
    'data/tasks.json',
    'data/stats.json',
    'data/search.md',
    'data/patterns.json',
    'journal/.gitkeep',
    'journal/README.md',
    'journal',
    'reports/.gitkeep',
    'reports/README.md',
    'reports/dashboard.md',
    'reports/work-patterns.md',
    'reports/monthly',
    'reports/yearly',
    'reports/idea-log-inventory.md',
    'reports/source-scan-summary.json',
    'reports/doctor.md',
    'reports/output-index.md',
    'reports/output-index.json',
    'dist/.gitkeep'
)

for ($attempt = 0; $attempt -lt 6; $attempt++) {
    try {
        $includedEntries = New-Object 'System.Collections.Generic.HashSet[string]'
        $tempZipPath = Join-Path $DistDir ('.tmp-' + [System.Guid]::NewGuid().ToString('N') + '-' + $zipName)
        $fs = [System.IO.File]::Open($tempZipPath, [System.IO.FileMode]::CreateNew)
        $zip = [System.IO.Compression.ZipArchive]::new($fs, [System.IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($item in $items) { Add-ZipPath $zip $item }
        } finally {
            $zip.Dispose()
            $fs.Dispose()
        }
        break
    } catch {
        if ($attempt -ge 5) {
            Write-Host "ERROR: ZipArchive failed after 6 attempts: $($_.Exception.Message)" -ForegroundColor Red
            exit 3
        }
        Write-Host "[package-local] compress retry $($attempt + 1)..." -ForegroundColor Yellow
        Start-Sleep -Milliseconds (500 * [Math]::Pow(2, $attempt))
        if ($tempZipPath -and (Test-Path -LiteralPath $tempZipPath)) {
            try { Remove-Item -LiteralPath $tempZipPath -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
}

if (-not $tempZipPath -or -not (Test-Path -LiteralPath $tempZipPath)) {
    Write-Host "ERROR: temp zip was not created." -ForegroundColor Red
    exit 4
}
if ($includedEntries.Count -eq 0) {
    Write-Host "ERROR: no files were added to the zip." -ForegroundColor Red
    exit 2
}

# Replace only the package file this script owns, after the temp zip is complete.
for ($attempt = 0; $attempt -lt 8; $attempt++) {
    try {
        if (Test-Path -LiteralPath $zipPath) {
            Remove-Item -LiteralPath $zipPath -Force -ErrorAction Stop
        }
        Move-Item -LiteralPath $tempZipPath -Destination $zipPath -Force -ErrorAction Stop
        break
    } catch {
        if ($attempt -ge 7) {
            Write-Host "ERROR: could not replace old zip after 8 attempts: $($_.Exception.Message)" -ForegroundColor Red
            if ($tempZipPath -and (Test-Path -LiteralPath $tempZipPath)) {
                Write-Host "[package-local] temp zip left for inspection: $tempZipPath" -ForegroundColor Yellow
            }
            exit 5
        }
        Write-Host "[package-local] old zip locked, retry $($attempt + 1)..." -ForegroundColor Yellow
        Start-Sleep -Milliseconds (200 * [Math]::Pow(2, $attempt))
    }
}

$zippedSize = (Get-Item -LiteralPath $zipPath).Length
Write-Host "[package-local] created: $zipPath"
Write-Host "[package-local] size: $zippedSize bytes"

$foundExcluded = @()
try {
    $fs = [System.IO.File]::OpenRead($zipPath)
    $za = [System.IO.Compression.ZipArchive]::new($fs)
    foreach ($entry in $za.Entries) {
        if ($entry.FullName -match '\\') { $foundExcluded += "BACKSLASH_ENTRY: $($entry.FullName)" }
        $name = $entry.FullName -replace '[/\\]', '/'
        if ($name -match 'data/index\.json') { $foundExcluded += $name }
        elseif ($name -match 'node_modules')  { $foundExcluded += $name }
        elseif ($name -match '(^|/)\.env')    { $foundExcluded += $name }
        elseif ($name -match '(^|/)\.git/')   { $foundExcluded += $name }
        elseif ($name -match 'reports/errors\.log') { $foundExcluded += $name }
        elseif ($name -match 'dist/.*\.zip$') { $foundExcluded += $name }
    }
    $za.Dispose()
    $fs.Close()
} catch {
    Write-Host "[package-local] ERROR: exclusion check reader failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 8
}

if ($foundExcluded.Count -eq 0) {
    Write-Host "[package-local] exclusion check passed."
} else {
    Write-Host "[package-local] ERROR: excluded or invalid items found in zip:" -ForegroundColor Red
    foreach ($x in $foundExcluded) { Write-Host "  $x" -ForegroundColor Red }
    exit 9
}

Write-Host "[package-local] done. (no git, no upload)"
exit 0
