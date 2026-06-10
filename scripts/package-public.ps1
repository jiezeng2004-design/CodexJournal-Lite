# scripts/package-public.ps1
#
# Creates dist/CodexJournal-Lite-v<package-version>-public.zip containing ONLY
# public source code, documentation, fixtures, and placeholder files.
#
# This is the package intended for GitHub Releases. It must NEVER include
# generated personal outputs. For a local handoff that includes your own
# archive data, use `npm run package:local` instead.
#
# Hard exclusions (these files are NEVER included, even if they exist on disk):
#   data/tasks.json
#   data/stats.json
#   data/search.md
#   data/patterns.json
#   data/index.json
#   journal/*.md
#   reports/*.md
#   reports/*.json
#   reports/monthly/*
#   reports/yearly/*
#   dist/*.zip
#   .git/
#   node_modules/
#   .env / .env.*
#   *.tmp
#   *.log / *.log.err
#
# Stability:
#   - Uses .NET ZipArchive so every entry name is an explicit project-relative
#     POSIX path (src/index.js), never a Windows path (src\index.js).
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

$zipName = "CodexJournal-Lite-v$Version-public.zip"
$zipPath = Join-Path $DistDir $zipName

Write-Host "[package-public] Creating: $zipPath"

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
    # Normalize to POSIX separators for matching.
    $name = $EntryName -replace '\\', '/'

    # Always-excluded directories and patterns.
    if ($name -match '(^|/)node_modules/') { return $true }
    if ($name -match '(^|/)\.git/') { return $true }
    if ($name -match '(^|/)\.env($|\.)') { return $true }

    # Whitelist: placeholder files that keep directory structure in git.
    # These are committed source, not generated personal data.
    if ($name -match '(^|/)(data|journal|reports|dist)/\.gitkeep$') { return $false }
    if ($name -match '(^|/)(data|journal|reports)/README\.md$') { return $false }

    # Whitelist: test-fixture .log files are committed source, not generated.
    if ($name -match '(^|/)test-fixtures/') { return $false }

    # Generated personal outputs — NEVER included in public package.
    if ($name -match '(^|/)data/tasks\.json$') { return $true }
    if ($name -match '(^|/)data/stats\.json$') { return $true }
    if ($name -match '(^|/)data/search\.md$') { return $true }
    if ($name -match '(^|/)data/patterns\.json$') { return $true }
    if ($name -match '(^|/)data/index\.json$') { return $true }
    if ($name -match '(^|/)journal/[^/]+\.md$') { return $true }
    if ($name -match '(^|/)reports/[^/]+\.md$') { return $true }
    if ($name -match '(^|/)reports/[^/]+\.json$') { return $true }
    if ($name -match '(^|/)reports/monthly/') { return $true }
    if ($name -match '(^|/)reports/yearly/') { return $true }
    if ($name -match '(^|/)dist/.*\.zip$') { return $true }

    # Temp and log files (but test-fixture .log files are whitelisted above).
    if ($name -match '\.tmp$') { return $true }
    if ($name -match '\.log$' -or $name -match '\.log\.err$') { return $true }
    if ($name -match '(^|/)reports/\.tmp/') { return $true }

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

# Public-only items. No generated personal outputs are listed here.
# Placeholder files (.gitkeep, README.md) in data/, journal/, reports/, dist/
# are included so the directory structure stays intact on the recipient's side.
$items = @(
    'src',
    'scripts',
    'docs',
    'console',
    'test-fixtures',
    '.github',
    'config.json',
    'package.json',
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
    'SECURITY.md',
    'CONTRIBUTING.md',
    '.gitignore',
    '.gitattributes',
    'data/.gitkeep',
    'data/README.md',
    'journal/.gitkeep',
    'journal/README.md',
    'reports/.gitkeep',
    'reports/README.md',
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
        Write-Host "[package-public] compress retry $($attempt + 1)..." -ForegroundColor Yellow
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
                Write-Host "[package-public] temp zip left for inspection: $tempZipPath" -ForegroundColor Yellow
            }
            exit 5
        }
        Write-Host "[package-public] old zip locked, retry $($attempt + 1)..." -ForegroundColor Yellow
        Start-Sleep -Milliseconds (200 * [Math]::Pow(2, $attempt))
    }
}

$zippedSize = (Get-Item -LiteralPath $zipPath).Length
Write-Host "[package-public] created: $zipPath"
Write-Host "[package-public] size: $zippedSize bytes"

# Exclusion verification: scan the zip and FAIL if any generated personal
# output or excluded item is found inside.
$foundExcluded = @()
try {
    $fs = [System.IO.File]::OpenRead($zipPath)
    $za = [System.IO.Compression.ZipArchive]::new($fs)
    foreach ($entry in $za.Entries) {
        if ($entry.FullName -match '\\') {
            $foundExcluded += "BACKSLASH_ENTRY: $($entry.FullName)"
        }
        $name = $entry.FullName -replace '[/\\]', '/'

        # Whitelist: committed placeholder files and test fixtures.
        if ($name -match '(^|/)(data|journal|reports|dist)/\.gitkeep$') { continue }
        if ($name -match '(^|/)(data|journal|reports)/README\.md$') { continue }
        if ($name -match '(^|/)test-fixtures/') { continue }

        if ($name -match 'data/tasks\.json$') { $foundExcluded += $name }
        elseif ($name -match 'data/stats\.json$') { $foundExcluded += $name }
        elseif ($name -match 'data/search\.md$') { $foundExcluded += $name }
        elseif ($name -match 'data/patterns\.json$') { $foundExcluded += $name }
        elseif ($name -match 'data/index\.json$') { $foundExcluded += $name }
        elseif ($name -match 'journal/[^/]+\.md$') { $foundExcluded += $name }
        elseif ($name -match 'reports/[^/]+\.md$') { $foundExcluded += $name }
        elseif ($name -match 'reports/[^/]+\.json$') { $foundExcluded += $name }
        elseif ($name -match 'reports/monthly/') { $foundExcluded += $name }
        elseif ($name -match 'reports/yearly/') { $foundExcluded += $name }
        elseif ($name -match 'dist/.*\.zip$') { $foundExcluded += $name }
        elseif ($name -match 'node_modules/')  { $foundExcluded += $name }
        elseif ($name -match '(^|/)\.env')     { $foundExcluded += $name }
        elseif ($name -match '(^|/)\.git/')    { $foundExcluded += $name }
        elseif ($name -match '\.tmp$')         { $foundExcluded += $name }
        elseif ($name -match '\.log$' -or $name -match '\.log\.err$') { $foundExcluded += $name }
    }
    $za.Dispose()
    $fs.Close()
} catch {
    Write-Host "[package-public] ERROR: exclusion check reader failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 8
}

if ($foundExcluded.Count -eq 0) {
    Write-Host "[package-public] exclusion check passed (no generated personal outputs in zip)."
} else {
    Write-Host "[package-public] ERROR: excluded or invalid items found in public zip:" -ForegroundColor Red
    foreach ($x in $foundExcluded) { Write-Host "  $x" -ForegroundColor Red }
    exit 9
}

Write-Host "[package-public] done. This zip is safe for GitHub Releases."
exit 0
