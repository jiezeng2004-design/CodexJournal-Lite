# scripts/verify.ps1
#
# End-to-end verification for CodexJournal-Lite.
#
# Hard rules:
#   - Never runs a real `git add` / `git commit` / `git push`.
#   - Never registers a Windows scheduled task.
#   - Never modifies or deletes anything under %USERPROFILE%\.codex.
#   - Never edits user files outside this project root.
#   - Never mutates archive outputs (reports/dashboard.md, journal/,
#     data/tasks.json, data/stats.json, data/search.md, data/index.json) from
#     the scan-sources path. Only source-scan reports are allowed to change.
#
# Output is a sequence of `[PASS] / [FAIL] / [WARN] / [INFO]` lines plus
# a final summary. Exit code is 0 if every required check passed,
# 1 otherwise. Warnings do not affect the exit code.
#
# Required structure:
#   - Section A: npm run check
#   - Section B: npm run archive -- --force
#   - Section C: real Windows username must not appear in user-visible output
#   - Section D: real credential patterns must not appear in user-visible output
#   - Section E: title pollution check (no AGENTS.md / agent history prefixes)
#   - Section F: every task in data/tasks.json has the required fields
#   - Section G: every task.date matches Asia/Shanghai local date of firstTimestamp
#   - Section H: at least one journal file and at least one task exist
#   - Section I: scripts/git-commit.ps1 -DryRun returns 0 or 4 (no other code)
#   - Section K: npm run scan-sources runs cleanly and is byte-for-byte
#     non-mutating to archive outputs; reports/idea-log-inventory.md exists
#     and does not contain a real Windows username
#   - Section L: npm run summarize runs cleanly and is non-mutating to
#     archive outputs; monthly/yearly leak checks
#   - Section M: npm run doctor, index:outputs, package:local run cleanly;
#     zip exclusion checks
#   - Section J: summary

[CmdletBinding()]
param(
    [switch]$SkipArchive,

    # Sanity-check mode for a freshly-cloned repo that has not yet produced
    # any archive output. Skips the "must have at least 1 task and 1
    # journal file" requirement in section H, and downgrades the
    # "summarize produced N output files" expectations in L to warnings
    # (which depend on real data existing). Every other check still runs.
    # -Fresh implies -SkipArchive: there is no point running the full
    # archive pass on a fresh clone, and it would only write empty data
    # files that defeat the purpose of the H check.
    [switch]$Fresh
)

$ErrorActionPreference = 'Stop'

# -Fresh implies -SkipArchive. Note: we cannot call Write-Info here
# because that helper is defined further down; an inline Write-Host
# avoids the PowerShell 5.1 "function used before definition" trap.
if ($Fresh) {
    $SkipArchive = $true
    Write-Host '[INFO] verify: -Fresh mode -> -SkipArchive implied. Sections H and L are downgraded to warnings for data-dependent checks.' -ForegroundColor Cyan
}

# ---------------------------------------------------------------- paths --
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir '..')
$PackageJson = Join-Path $ProjectRoot 'package.json'
$VerifyPs1   = $MyInvocation.MyCommand.Path
$GitCommitPs1 = Join-Path $ScriptDir 'git-commit.ps1'
$InstallTaskPs1    = Join-Path $ScriptDir 'install-task.ps1'
$PackageLocalScript = Join-Path $ScriptDir 'package-local.ps1'

try {
    $ProjectVersion = (Get-Content -LiteralPath $PackageJson -Raw | ConvertFrom-Json).version
} catch {
    $ProjectVersion = 'unknown'
}

# ---------------------------------------------------------------- state --
$script:passedCount  = 0
$script:failedCount  = 0
$script:warningCount = 0

function Write-Section([string]$name) {
    Write-Host ''
    Write-Host ('==[ ' + $name + ' ]' + ('=' * [Math]::Max(0, 60 - $name.Length)))
}

function Write-Pass([string]$msg) {
    $script:passedCount += 1
    Write-Host ('[PASS] ' + $msg) -ForegroundColor Green
}
function Write-Fail([string]$msg) {
    $script:failedCount += 1
    Write-Host ('[FAIL] ' + $msg) -ForegroundColor Red
}
function Write-Warn([string]$msg) {
    $script:warningCount += 1
    Write-Host ('[WARN] ' + $msg) -ForegroundColor Yellow
}
function Write-Info([string]$msg) {
    Write-Host ('[INFO] ' + $msg) -ForegroundColor Cyan
}

# Run a script block and return its exit code. We do NOT use `& { ... }`
# because that loses $LASTEXITCODE in some PowerShell host configurations.
function Invoke-Step([string]$title, [scriptblock]$block) {
    # Capture and discard all output streams so stdout does not get folded
    # into the function's return value (which would shadow $LASTEXITCODE).
    # The local $ErrorActionPreference override is required because the
    # top-level preference is 'Stop'; if the inner command exits non-zero
    # and writes to stderr, a `& $block` would throw and abort the whole
    # verify run. We want the exit code surfaced as a return value, not
    # as a hard error.
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $block *>&1 | Out-Null
    } finally {
        $ErrorActionPreference = $prevPref
    }
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
    return [int]$code
}

# ----------------------------------------------------- tool availability --
function Resolve-NpmCmd {
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($null -ne $npmCmd) { return $npmCmd.Path }
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($null -ne $npmCmd) { return $npmCmd.Path }
    return $null
}

$npmPath = Resolve-NpmCmd
if ($null -eq $npmPath) {
    Write-Fail 'A: npm / npm.cmd not found in PATH. install Node.js first.'
    Write-Summary
    exit 1
}

# ============================================================ A. npm check
Write-Section 'A. npm run check'

$checkCode = Invoke-Step 'npm run check' {
    & $npmPath run check 2>&1 | Out-Host
}
if ($checkCode -eq 0) {
    Write-Pass "A: npm run check exited 0"
} else {
    Write-Fail "A: npm run check exited $checkCode"
}

# ========================================================== B. archive force
Write-Section 'B. npm run archive -- --force'

if ($SkipArchive) {
    Write-Info 'B: skipped (--SkipArchive passed). re-run without --SkipArchive to re-archive.'
} else {
    $archiveCode = Invoke-Step 'npm run archive' {
        & $npmPath run archive -- --force 2>&1 | Out-Host
    }
    if ($archiveCode -eq 0) {
        Write-Pass 'B: npm run archive -- --force exited 0'
    } else {
        Write-Fail "B: npm run archive -- --force exited $archiveCode"
    }
}

# ========================================== C. real Windows username leak
Write-Section 'C. real Windows username leak check'

# Discover the real local user name from the runtime, never hard-code.
$realUsers = New-Object System.Collections.Generic.HashSet[string]
$realUsers.Add([string]$env:USERNAME) | Out-Null
try {
    $un = [System.Environment]::UserName
    if ($un) { $realUsers.Add([string]$un) | Out-Null }
} catch {}
try {
    $up = [string]$env:USERPROFILE
    if ($up) {
        $leaf = Split-Path -Leaf $up
        if ($leaf) { $realUsers.Add([string]$leaf) | Out-Null }
    }
} catch {}
$realUsers = $realUsers | Where-Object { $_ -and $_.Length -ge 1 }
Write-Info ("C: real user candidates: " + (($realUsers | Sort-Object) -join ', '))

# File set: README.md, reports/dashboard.md, journal/, data/, excluding data/index.json.
$scanFiles = @()
$scanFiles += Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'README.md') -File -ErrorAction SilentlyContinue
$scanFiles += Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'reports/dashboard.md') -File -ErrorAction SilentlyContinue
$scanFiles += Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'journal') -Recurse -File -ErrorAction SilentlyContinue
$scanFiles += Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'data')   -Recurse -File -ErrorAction SilentlyContinue
$scanFiles = $scanFiles | Where-Object { $_.Name -ne 'index.json' }

$leakHits = @()
foreach ($f in $scanFiles) {
    foreach ($u in $realUsers) {
        if (-not $u) { continue }
        $esc = [regex]::Escape($u)
        # Three forms the redaction layer is supposed to cover:
        #   C:\Users\<user>     (single backslash, path or prompt)
        #   C:/Users/<user>     (forward slash)
        #   C:\\Users\\<user>\\ (double backslash, JSON-string content)
        $patterns = @(
            ('C:\\Users\\' + $esc),           # C:\Users\xxx  (or C:\Users\xxx>)
            ('C:/Users/'   + $esc),           # C:/Users/xxx
            ('C:\\\\Users\\\\' + $esc + '\\\\') # C:\\Users\\xxx\\
        )
        foreach ($p in $patterns) {
            $m = Select-String -LiteralPath $f.FullName -Pattern $p -SimpleMatch -ErrorAction SilentlyContinue
            if ($m) {
                foreach ($hit in $m) {
                    $leakHits += [PSCustomObject]@{
                        user   = $u
                        pattern = $p
                        file   = $f.FullName.Replace($ProjectRoot.Path, '').TrimStart('\','/')
                        line   = $hit.LineNumber
                        text   = $hit.Line
                    }
                }
            }
        }
    }
}
if ($leakHits.Count -eq 0) {
    Write-Pass 'C: no real Windows username path appears in README.md / reports/dashboard.md / journal / data (excluding data/index.json).'
} else {
    $sample = $leakHits | Select-Object -First 5
    foreach ($h in $sample) {
        Write-Fail ("C: leak user='" + $h.user + "' pattern='" + $h.pattern + "' in " + $h.file + ':' + $h.line)
    }
    if ($leakHits.Count -gt 5) {
        Write-Fail ("C: ... and " + ($leakHits.Count - 5) + ' more leak(s) suppressed in the log.')
    }
}

# ============================================== D. credential pattern scan
Write-Section 'D. credential pattern scan'

$credPatterns = @(
    @{ name = 'openai-key';       pat = 'sk-[A-Za-z0-9_\-]{8,}' },
    @{ name = 'bearer';           pat = 'Bearer\s+[A-Za-z0-9._\-/+=]{6,}' },
    @{ name = 'openai-env';       pat = 'OPENAI_API_KEY\s*[:=]' },
    @{ name = 'anthropic-env';    pat = 'ANTHROPIC_API_KEY\s*[:=]' },
    @{ name = 'gemini-env';       pat = 'GEMINI_API_KEY\s*[:=]' },
    # Word-boundary anchored, and require a value of >= 6 non-whitespace
    # characters that is not `<`. This avoids false positives on the
    # auto-generated keyword lists (e.g. `` `authorization` `` where the
    # surrounding backtick is a single non-whitespace char) while still
    # catching real `Authorization: Bearer ...` style leaks.
    @{ name = 'authorization';    pat = '(?<![\w])authorization\s*[:=]\s*[^\s<]{6,}' },
    @{ name = 'cookie';           pat = '(?<![\w])cookie\s*[:=]\s*[^\s<]{6,}' },
    @{ name = 'sessionid';        pat = '(?<![\w])sessionid\s*[:=]\s*[^\s<]{6,}' },
    @{ name = 'connect-sid';      pat = '(?<![\w])connect\.sid\s*[:=]\s*[^\s<]{6,}' }
)

# These README-only lines are documentation examples. We must accept
# them as WARN, not FAIL, when the file is README.md.
$readmeExamplePlaceholders = @(
    'sk-...',
    'sk-proj-...',
    'OPENAI_API_KEY=...',
    'Bearer eyJ',
    'Bearer <REDACTED>',
    'ghp_...',
    'xoxb-...'
)

$credFiles = @()
$credFiles += Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'README.md') -File -ErrorAction SilentlyContinue
$credFiles += Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'reports/dashboard.md') -File -ErrorAction SilentlyContinue
$credFiles += Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'journal') -Recurse -File -ErrorAction SilentlyContinue
$credFiles += Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'data')   -Recurse -File -ErrorAction SilentlyContinue
$credFiles = $credFiles | Where-Object { $_.Name -ne 'index.json' }

$realCredHits = @()
$warnCredHits = @()
foreach ($f in $credFiles) {
    foreach ($p in $credPatterns) {
        $m = Select-String -LiteralPath $f.FullName -Pattern $p.pat -ErrorAction SilentlyContinue
        if ($m) {
            foreach ($hit in $m) {
                $lineText = $hit.Line
                $isReadme = $f.Name -ieq 'README.md'
                $isExample = $false
                if ($isReadme) {
                    foreach ($placeholder in $readmeExamplePlaceholders) {
                        if ($lineText -like "*$placeholder*") { $isExample = $true; break }
                    }
                }
                $record = [PSCustomObject]@{
                    pattern = $p.name
                    file    = $f.FullName.Replace($ProjectRoot.Path, '').TrimStart('\','/')
                    line    = $hit.LineNumber
                    text    = $lineText
                    isReadme = $isReadme
                    isExample = $isExample
                }
                if ($isReadme -and $isExample) {
                    $warnCredHits += $record
                } else {
                    $realCredHits += $record
                }
            }
        }
    }
}

if ($realCredHits.Count -eq 0) {
    Write-Pass 'D: no real credential pattern found in README.md / reports/dashboard.md / journal / data (excluding data/index.json).'
} else {
    foreach ($h in ($realCredHits | Select-Object -First 5)) {
        $sampleText = $h.text
        if ($sampleText.Length -gt 160) { $sampleText = $sampleText.Substring(0, 160) + '...' }
        Write-Fail ("D: credential hit pattern='" + $h.pattern + "' in " + $h.file + ':' + $h.line + ' :: ' + $sampleText)
    }
    if ($realCredHits.Count -gt 5) {
        Write-Fail ("D: ... and " + ($realCredHits.Count - 5) + ' more credential hit(s) suppressed.')
    }
}

if ($warnCredHits.Count -gt 0) {
    Write-Warn ("D: " + $warnCredHits.Count + " hit(s) inside README.md look like documentation placeholders (sk-..., OPENAI_API_KEY=..., Bearer eyJ, ghp_..., xoxb_...). These are accepted as WARN, not FAIL. If you add a new README example, update `$readmeExamplePlaceholders` in scripts/verify.ps1 so it stays accepted.")
}

# =========================================================== E. title pollution
Write-Section 'E. title pollution check'

$tasksFile = Join-Path $ProjectRoot 'data\tasks.json'
$tasksForE = $null
if (-not (Test-Path -LiteralPath $tasksFile)) {
    if ($Fresh) {
        Write-Warn "E: $tasksFile not found; run npm run archive first (skipped in -Fresh mode)."
    } else {
        Write-Fail "E: $tasksFile not found; run npm run archive first."
    }
} else {
    try {
        $tasksForE = Get-Content -LiteralPath $tasksFile -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Write-Fail "E: could not parse $tasksFile as JSON: $($_.Exception.Message)"
    }
    if ($null -ne $tasksForE) {
        $eCode = Invoke-Step 'node title pollution' {
            & node -e @"
const fs=require('fs');
const d=JSON.parse(fs.readFileSync('$($tasksFile -replace '\\','\\\\')','utf8'));
const a=d.tasks.filter(t=>/^# AGENTS\.md instructions/.test(t.title)).length;
const b=d.tasks.filter(t=>/^The following is the Codex agent history/.test(t.title)).length;
const c=d.tasks.filter(t=>t.title==='(no user request)').length;
console.log(JSON.stringify({agentsTitleCount:a,historyTitleCount:b,noUserRequestCount:c,total:d.tasks.length}));
if(a||b||c) process.exit(1);
"@
        }
        if ($eCode -eq 0) {
            Write-Pass "E: title pollution is 0 (no AGENTS.md / agent-history / no-user-request titles)."
        } else {
            Write-Fail "E: title pollution > 0. Re-run npm run archive and inspect data/tasks.json."
        }
    }
}

# =============================================== F. tasks field completeness
Write-Section 'F. tasks field completeness'

if ($null -eq $tasksForE) {
    if ($Fresh) {
        Write-Warn 'F: skipped, data/tasks.json was not loaded in section E (no data in -Fresh mode).'
    } else {
        Write-Fail 'F: skipped, data/tasks.json was not loaded in section E.'
    }
} else {
    $fCode = Invoke-Step 'node field check' {
        & node -e @"
const fs=require('fs');
const d=JSON.parse(fs.readFileSync('$($tasksFile -replace '\\','\\\\')','utf8'));
const req=['id','date','time','source','projectPath','title','taskType','keywords','userSummary','assistantSummary','rawFilePath','messageCount','firstTimestamp','lastTimestamp'];
let bad=[];
for(const [i,t] of d.tasks.entries()){
  const miss=req.filter(k=>!(k in t));
  if(miss.length) bad.push({i,id:t&&t.id,miss});
}
console.log(JSON.stringify({badFieldCount:bad.length,total:d.tasks.length,sampleMisses:bad.slice(0,3)}));
if(bad.length) process.exit(1);
"@
    }
    if ($fCode -eq 0) {
        Write-Pass 'F: every task in data/tasks.json has all 14 required fields.'
    } else {
        Write-Fail 'F: at least one task is missing required fields. See sampleMisses in the output above.'
    }
}

# ====================================================== G. date correctness
Write-Section 'G. date correctness (Asia/Shanghai local date == task.date)'

if ($null -eq $tasksForE) {
    if ($Fresh) {
        Write-Warn 'G: skipped, data/tasks.json was not loaded in section E (no data in -Fresh mode).'
    } else {
        Write-Fail 'G: skipped, data/tasks.json was not loaded in section E.'
    }
} else {
    $gCode = Invoke-Step 'node date check' {
        & node -e @"
const fs=require('fs');
const d=JSON.parse(fs.readFileSync('$($tasksFile -replace '\\','\\\\')','utf8'));
const dateBad=d.tasks.filter(t=>t.date!=='unknown' && t.firstTimestamp && t.date!==new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t.firstTimestamp)));
console.log(JSON.stringify({badDateCount:dateBad.length,total:d.tasks.length,sample:dateBad.slice(0,3).map(t=>({id:t.id,date:t.date,firstTimestamp:t.firstTimestamp}))}));
if(dateBad.length) process.exit(1);
"@
    }
    if ($gCode -eq 0) {
        Write-Pass 'G: every task.date matches the Asia/Shanghai local date of firstTimestamp (or is "unknown").'
    } else {
        Write-Fail 'G: at least one task.date does not match the Asia/Shanghai local date of firstTimestamp.'
    }
}

# ================================================= H. journal + tasks count
Write-Section 'H. journal + tasks count check'

$journalDir = Join-Path $ProjectRoot 'journal'
$journalCount = 0
if (Test-Path -LiteralPath $journalDir) {
    $journalCount = (Get-ChildItem -LiteralPath $journalDir -Filter '*.md' -File -ErrorAction SilentlyContinue | Measure-Object).Count
}
$taskCount = 0
if ($null -ne $tasksForE) { $taskCount = @($tasksForE.tasks).Count }

if ($journalCount -ge 1) {
    Write-Pass "H: journal/ has $journalCount .md file(s) (>= 1)."
} else {
    if ($Fresh) {
        Write-Warn "H: journal/ has 0 .md files (skipped in -Fresh mode). Run 'npm run archive' to populate."
    } else {
        Write-Fail "H: journal/ has 0 .md files."
    }
}
if ($taskCount -ge 1) {
    Write-Pass "H: data/tasks.json has $taskCount task(s) (>= 1)."
} else {
    if ($Fresh) {
        Write-Warn "H: data/tasks.json has 0 tasks (skipped in -Fresh mode). Run 'npm run archive' to populate."
    } else {
        Write-Fail "H: data/tasks.json has 0 tasks."
    }
}

# ========================================== I. git-commit.ps1 DryRun safety
Write-Section 'I. git-commit.ps1 -DryRun safety'

if (-not (Test-Path -LiteralPath $GitCommitPs1)) {
    Write-Fail "I: $GitCommitPs1 not found."
} else {
    $psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $psExe)) {
        Write-Fail "I: powershell.exe not found at $psExe"
    } else {
        $p = Start-Process -FilePath $psExe `
            -ArgumentList @(
                '-NoProfile', '-ExecutionPolicy', 'Bypass',
                '-File', $GitCommitPs1, '-DryRun'
            ) `
            -WorkingDirectory $ProjectRoot `
            -Wait -PassThru -NoNewWindow
        $ec = [int]$p.ExitCode
        switch ($ec) {
            0 {
                Write-Pass "I: git-commit.ps1 -DryRun exited 0 (project is its own git repo root, dry-run succeeded)."
            }
            4 {
                Write-Pass "I: git-commit.ps1 -DryRun exited 4 (project is inside a parent git repo, the script correctly refused to operate without -AllowUnsafeParentRepo). This is the expected state on this machine."
            }
            default {
                Write-Fail "I: git-commit.ps1 -DryRun exited $ec. Expected 0 (project is its own git repo root) or 4 (project is a sub-dir of a parent git repo and the script refused). Anything else means the safety logic is broken."
            }
        }
    }
}

# Note: we never touch install-task.ps1 here on purpose.
Write-Info "I: $InstallTaskPs1 was NOT invoked by verify. Scheduled tasks are never created by this script."

# ============================================================ K. scan-sources safety
Write-Section 'K. scan-sources safety (v0.4.1)'

# 0. Run the offline test-suite first. It exercises the IDEA / JetBrains
#    probe against the synthetic tree under test-fixtures/idea-logs/
#    and does NOT depend on any real JetBrains installation on the host.
$testSourcesExit = Invoke-Step 'npm run test:sources' {
    & $npmPath run test:sources *>&1 | Out-Null
}
if ($testSourcesExit -eq 0) {
    Write-Pass 'K: npm run test:sources exited 0 (offline IDEA-fixture test suite green).'
} else {
    Write-Fail ("K: npm run test:sources exited $testSourcesExit. The offline IDEA-fixture test suite failed; do not trust the live scan output until the fixtures are green again.")
}

# 1. Snapshot SHA-256 of every file that scan-sources is contractually
#    forbidden to touch. In v0.4.1 the allowlist for mutation is
#    exactly: `reports/idea-log-inventory.md` and
#    `reports/source-scan-summary.json`. Everything else is forbidden.
$protectedPaths = @(
    (Join-Path $ProjectRoot 'README.md'),
    (Join-Path $ProjectRoot 'reports/dashboard.md'),
    (Join-Path $ProjectRoot 'data/tasks.json'),
    (Join-Path $ProjectRoot 'data/stats.json'),
    (Join-Path $ProjectRoot 'data/search.md'),
    (Join-Path $ProjectRoot 'data/index.json')
)
# Plus every file under journal/ (Markdown, *.md).
$journalDirForK = Join-Path $ProjectRoot 'journal'
if (Test-Path -LiteralPath $journalDirForK) {
    Get-ChildItem -LiteralPath $journalDirForK -File -Filter '*.md' -ErrorAction SilentlyContinue |
        ForEach-Object { $protectedPaths += $_.FullName }
}

function Get-FileFingerprint {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return 'ABSENT' }
    try {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
        $sha   = [System.Security.Cryptography.SHA256]::Create()
        $hash  = $sha.ComputeHash($bytes)
        $sb = New-Object System.Text.StringBuilder ($hash.Length * 2)
        for ($i = 0; $i -lt $hash.Length; $i++) {
            [void]$sb.Append($hash[$i].ToString('x2'))
        }
        return $sb.ToString()
    } catch {
        return 'ERR:' + $_.Exception.Message
    }
}

$beforeMap = @{}
foreach ($p in $protectedPaths) {
    $beforeMap[$p] = Get-FileFingerprint $p
}
Write-Info ('K: snapshotted ' + $beforeMap.Count + ' protected file(s) before scan-sources.')

# 2. Run `npm run scan:sources`. We capture only the exit code; stdout is
#    discarded to avoid `& $cmd` folding the output into the return value.
$scanSourcesExit = Invoke-Step 'npm run scan:sources' {
    & $npmPath run scan:sources *>&1 | Out-Null
}
if ($scanSourcesExit -eq 0) {
    Write-Pass 'K: npm run scan:sources exited 0.'
} else {
    Write-Fail ("K: npm run scan:sources exited $scanSourcesExit. See the run-archive output above for the actual error.")
}

# 3. Verify the inventory file actually exists.
$inventoryFile = Join-Path $ProjectRoot 'reports\idea-log-inventory.md'
$summaryJsonFile = Join-Path $ProjectRoot 'reports\source-scan-summary.json'
if (Test-Path -LiteralPath $inventoryFile) {
    Write-Pass "K: reports/idea-log-inventory.md exists."
} else {
    Write-Fail "K: reports/idea-log-inventory.md is missing after npm run scan:sources."
}
if (Test-Path -LiteralPath $summaryJsonFile) {
    Write-Pass "K: reports/source-scan-summary.json exists."
} else {
    Write-Fail "K: reports/source-scan-summary.json is missing after npm run scan:sources."
}

# 3b. Verify the summary JSON is parseable and has the expected shape.
if (Test-Path -LiteralPath $summaryJsonFile) {
    try {
        $summaryObj = Get-Content -LiteralPath $summaryJsonFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($summaryObj.sources -and $summaryObj.sources.'idea-ai') {
            Write-Pass 'K: reports/source-scan-summary.json is valid JSON and contains sources["idea-ai"].'
        } else {
            Write-Fail 'K: reports/source-scan-summary.json is valid JSON but is missing sources["idea-ai"].'
        }
    } catch {
        Write-Fail ("K: reports/source-scan-summary.json is not valid JSON: " + $_.Exception.Message)
    }
}

# 4. Verify scan-sources did NOT mutate any of the protected paths.
#    We re-hash and compare to the snapshot. If any path differs,
#    scan-sources broke the v0.4.0 contract.
$mutated = @()
foreach ($p in $protectedPaths) {
    $after = Get-FileFingerprint $p
    if ($beforeMap[$p] -ne $after) {
        $mutated += [PSCustomObject]@{
            path       = $p.Replace($ProjectRoot.Path, '').TrimStart('\', '/')
            before     = $beforeMap[$p]
            after      = $after
        }
    }
}
if ($mutated.Count -eq 0) {
    Write-Pass 'K: scan-sources did NOT modify README.md / reports/dashboard.md / journal/ / data/tasks.json / data/stats.json / data/search.md / data/index.json.'
} else {
    foreach ($m in ($mutated | Select-Object -First 5)) {
        Write-Fail ("K: scan-sources MUTATED " + $m.path + ' (before=' + $m.before + ' after=' + $m.after + '). Only reports/idea-log-inventory.md is allowed to change.')
    }
    if ($mutated.Count -gt 5) {
        Write-Fail ('K: ... and ' + ($mutated.Count - 5) + ' more mutation(s) suppressed.')
    }
}

# 5. Verify the inventory file does NOT contain a real Windows username
#    (dynamic lookup, no hard-coding).
$realUsersForK = New-Object System.Collections.Generic.HashSet[string]
$realUsersForK.Add([string]$env:USERNAME) | Out-Null
try {
    $unK = [System.Environment]::UserName
    if ($unK) { $realUsersForK.Add([string]$unK) | Out-Null }
} catch {}
try {
    $upK = [string]$env:USERPROFILE
    if ($upK) {
        $leafK = Split-Path -Leaf $upK
        if ($leafK) { $realUsersForK.Add([string]$leafK) | Out-Null }
    }
} catch {}
$realUsersForK = $realUsersForK | Where-Object { $_ -and $_.Length -ge 1 }

$inventoryLeakHits = @()
if (Test-Path -LiteralPath $inventoryFile) {
    $content = [System.IO.File]::ReadAllText($inventoryFile, [System.Text.Encoding]::UTF8)
    foreach ($u in $realUsersForK) {
        if (-not $u) { continue }
        $hits = [regex]::Matches($content, 'C:\\Users\\' + [regex]::Escape($u))
        if ($hits.Count -gt 0) {
            $inventoryLeakHits += [PSCustomObject]@{
                user = $u
                count = $hits.Count
            }
        }
    }
}
if ($inventoryLeakHits.Count -eq 0) {
    Write-Pass 'K: reports/idea-log-inventory.md contains no real Windows username path (UTF-8 byte-level check).'
} else {
    foreach ($h in $inventoryLeakHits) {
        Write-Fail ("K: real username '" + $h.user + "' appears " + $h.count + ' time(s) in reports/idea-log-inventory.md.')
    }
}

# 5b. Same UTF-8 byte-level check on reports/source-scan-summary.json.
$summaryJsonLeakHits = @()
if (Test-Path -LiteralPath $summaryJsonFile) {
    $summaryText = [System.IO.File]::ReadAllText($summaryJsonFile, [System.Text.Encoding]::UTF8)
    foreach ($u in $realUsersForK) {
        if (-not $u) { continue }
        $hits = [regex]::Matches($summaryText, 'C:\\Users\\' + [regex]::Escape($u))
        if ($hits.Count -gt 0) {
            $summaryJsonLeakHits += [PSCustomObject]@{
                user = $u
                count = $hits.Count
            }
        }
    }
}
if ($summaryJsonLeakHits.Count -eq 0) {
    Write-Pass 'K: reports/source-scan-summary.json contains no real Windows username path (UTF-8 byte-level check).'
} else {
    foreach ($h in $summaryJsonLeakHits) {
        Write-Fail ("K: real username '" + $h.user + "' appears " + $h.count + ' time(s) in reports/source-scan-summary.json.')
    }
}

# 6. Belt-and-suspenders: confirm we never touched git / install-task.
Write-Info "K: install-task.ps1 was NOT invoked by verify. Scheduled tasks are never created by this script."
Write-Info "K: no `git add` / `git commit` / `git push` was executed. scan-sources itself does not touch git."

# =========================================================== L. summarize safety
Write-Section 'L. summarize safety'

# In -Fresh mode, summarize cannot produce meaningful monthly / yearly /
# patterns.json output because data/tasks.json is empty. The summarize
# command itself is still run (so any "summarize broke on empty input"
# bug is still caught), but the "output file must exist with content"
# checks are downgraded to warnings.
if ($Fresh) {
    Write-Info 'L: running in -Fresh mode. summarize-output existence checks downgraded to warnings.'
}

# 1. Snapshot SHA-256 of every file that summarize is contractually
#    forbidden to touch. The allowlist for mutate is:
#    - data/patterns.json
#    - reports/work-patterns.md
#    - reports/monthly/*.md
#    - reports/yearly/*.md
# Everything archive and scan-sources ever produces is forbidden.
$LprotectedPaths = @()
$LaddProtected = @(
    (Join-Path $ProjectRoot 'README.md'),
    (Join-Path $ProjectRoot 'reports/dashboard.md'),
    (Join-Path $ProjectRoot 'data/tasks.json'),
    (Join-Path $ProjectRoot 'data/stats.json'),
    (Join-Path $ProjectRoot 'data/search.md'),
    (Join-Path $ProjectRoot 'data/index.json'),
    (Join-Path $ProjectRoot 'reports/idea-log-inventory.md'),
    (Join-Path $ProjectRoot 'reports/source-scan-summary.json')
)
# Add journal files.
$journalForL = Join-Path $ProjectRoot 'journal'
if (Test-Path -LiteralPath $journalForL) {
    Get-ChildItem -LiteralPath $journalForL -File -Filter '*.md' -ErrorAction SilentlyContinue |
        ForEach-Object { $LprotectedPaths += $_.FullName }
}
foreach ($p in $LaddProtected) { $LprotectedPaths += $p }

$LbeforeHashes = @{}
foreach ($p in $LprotectedPaths) {
    $LbeforeHashes[$p] = Get-FileFingerprint $p
}
Write-Info ('L: snapshotted ' + $LbeforeHashes.Count + ' protected file(s) before summarize.')

# 2. Run `npm run summarize`.
$summarizeExit = Invoke-Step 'npm run summarize' {
    & $npmPath run summarize *>&1 | Out-Null
}
if ($summarizeExit -eq 0) {
    Write-Pass 'L: npm run summarize exited 0.'
} else {
    if ($Fresh) {
        Write-Warn ("L: npm run summarize exited $summarizeExit (running on empty data/tasks.json; output-file checks below are warnings).")
    } else {
        Write-Fail ("L: npm run summarize exited $summarizeExit.")
    }
}

# 3. Verify summarize outputs exist.
$LpatternsFile  = Join-Path $ProjectRoot 'data\patterns.json'
$LworkPatterns  = Join-Path $ProjectRoot 'reports\work-patterns.md'
$LmonthlyDir    = Join-Path $ProjectRoot 'reports\monthly'
$LyearlyDir     = Join-Path $ProjectRoot 'reports\yearly'

$LallOutputsOk = $true
if (Test-Path -LiteralPath $LpatternsFile) {
    Write-Pass 'L: data/patterns.json exists.'
} else {
    if ($Fresh) { Write-Warn 'L: data/patterns.json is missing (expected on empty data; -Fresh mode).'; }
    else        { Write-Fail 'L: data/patterns.json is missing.'; $LallOutputsOk = $false }
}

if (Test-Path -LiteralPath $LworkPatterns) {
    Write-Pass 'L: reports/work-patterns.md exists.'
} else {
    if ($Fresh) { Write-Warn 'L: reports/work-patterns.md is missing (expected on empty data; -Fresh mode).'; }
    else        { Write-Fail 'L: reports/work-patterns.md is missing.'; $LallOutputsOk = $false }
}

$LmonthlyCount = 0
if (Test-Path -LiteralPath $LmonthlyDir) {
    $LmonthlyCount = (Get-ChildItem -LiteralPath $LmonthlyDir -Filter '*.md' -File -ErrorAction SilentlyContinue | Measure-Object).Count
}
if ($LmonthlyCount -ge 1) {
    Write-Pass ("L: reports/monthly/ has $LmonthlyCount .md file(s) (>= 1).")
} else {
    if ($Fresh) { Write-Warn 'L: reports/monthly/ has 0 .md files (expected on empty data; -Fresh mode).'; }
    else        { Write-Fail 'L: reports/monthly/ has 0 .md files.'; $LallOutputsOk = $false }
}

$LyearlyCount = 0
if (Test-Path -LiteralPath $LyearlyDir) {
    $LyearlyCount = (Get-ChildItem -LiteralPath $LyearlyDir -Filter '*.md' -File -ErrorAction SilentlyContinue | Measure-Object).Count
}
if ($LyearlyCount -ge 1) {
    Write-Pass ("L: reports/yearly/ has $LyearlyCount .md file(s) (>= 1).")
} else {
    if ($Fresh) { Write-Warn 'L: reports/yearly/ has 0 .md files (expected on empty data; -Fresh mode).'; }
    else        { Write-Fail 'L: reports/yearly/ has 0 .md files.'; $LallOutputsOk = $false }
}

# 3b. Verify data/patterns.json is valid JSON, via Node.js (PS 5.1
#     ConvertFrom-Json has a depth limit that deep patterns would hit).
if ($LallOutputsOk -and (Test-Path -LiteralPath $LpatternsFile)) {
    $tmpScript = Join-Path $env:TEMP 'verify-patterns-json.js'
    @"
const fs=require('fs');
const p='$($LpatternsFile.Replace('\','\\').Replace("'","\'"))';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
process.exit(d&&d.totals&&typeof d.totals.tasks==='number'?0:1);
"@ | Set-Content -LiteralPath $tmpScript -Force -Encoding UTF8
    & node $tmpScript 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Pass 'L: data/patterns.json is valid JSON with expected schema (verified via Node.js).'
    } else {
        Write-Fail 'L: data/patterns.json failed Node.js schema validation.'
    }
    Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue
}

# 4. Check that summarize did NOT mutate the protected files.
$Lmutated = @()
foreach ($p in $LprotectedPaths) {
    $Lafter = Get-FileFingerprint $p
    if ($LbeforeHashes[$p] -ne $Lafter) {
        $Lmutated += $p.Replace($ProjectRoot.Path, '').TrimStart('\', '/')
    }
}
if ($Lmutated.Count -eq 0) {
    Write-Pass 'L: summarize did NOT modify README.md / reports/dashboard.md / journal/ / data/tasks.json / data/stats.json / data/search.md / data/index.json / reports/idea-log-inventory.md / reports/source-scan-summary.json.'
} else {
    foreach ($m in ($Lmutated | Select-Object -First 5)) {
        Write-Fail ("L: summarize MUTATED " + $m + '. Only data/patterns.json, reports/work-patterns.md, reports/monthly/*.md, and reports/yearly/*.md are allowed to change.')
    }
}

# 5. Real-username check on the two main summarize outputs: data/patterns.json
#    and reports/work-patterns.md, plus every monthly and yearly report.
#    We re-use $realUsersForK from Section K.
$LleakHits = @()
$LcontentSources = New-Object System.Collections.ArrayList
[void]$LcontentSources.Add(@{ label = "data/patterns.json"; path = $LpatternsFile })
[void]$LcontentSources.Add(@{ label = "reports/work-patterns.md"; path = $LworkPatterns })
if (Test-Path -LiteralPath $LmonthlyDir) {
    Get-ChildItem -LiteralPath $LmonthlyDir -File -Filter '*.md' -ErrorAction SilentlyContinue |
        ForEach-Object { [void]$LcontentSources.Add(@{ label = ("monthly/" + $_.Name); path = $_.FullName }) }
    }
if (Test-Path -LiteralPath $LyearlyDir) {
    Get-ChildItem -LiteralPath $LyearlyDir -File -Filter '*.md' -ErrorAction SilentlyContinue |
        ForEach-Object { [void]$LcontentSources.Add(@{ label = ("yearly/" + $_.Name); path = $_.FullName }) }
    }
foreach ($src in $LcontentSources) {
    if (-not (Test-Path -LiteralPath $src.path)) { continue }
    $text = [System.IO.File]::ReadAllText($src.path, [System.Text.Encoding]::UTF8)
    foreach ($u in $realUsersForK) {
        if (-not $u) { continue }
        $hits = [regex]::Matches($text, 'C:\\Users\\' + [regex]::Escape($u))
        if ($hits.Count -gt 0) {
            $LleakHits += [PSCustomObject]@{ file = $src.label; user = $u; count = $hits.Count }
        }
    }
}
if ($LleakHits.Count -eq 0) {
    Write-Pass 'L: data/patterns.json and reports/work-patterns.md contain no real Windows username path (UTF-8 byte-level).'
} else {
    foreach ($h in $LleakHits) {
        Write-Fail ("L: real username '" + $h.user + "' appears " + $h.count + ' time(s) in ' + $h.file + '.')
    }
}

# 6. Credential pattern check on patterns.json and work-patterns.md (surface-level).
$LcredPatterns = @('sk-[A-Za-z0-9_\-]{8,}', 'OPENAI_API_KEY\s*[:=]', 'Bearer\s+[A-Za-z0-9._\-/+=]{6,}')
$LcredHits = @()
foreach ($src in $LcontentSources) {
    if (-not (Test-Path -LiteralPath $src.path)) { continue }
    $text = [System.IO.File]::ReadAllText($src.path, [System.Text.Encoding]::UTF8)
    foreach ($pat in $LcredPatterns) {
        $m = [regex]::Matches($text, $pat)
        if ($m.Count -gt 0) { $LcredHits += [PSCustomObject]@{ file = $src.label; pattern = $pat } }
    }
}
if ($LcredHits.Count -eq 0) {
    Write-Pass 'L: no real credential pattern found in patterns.json, work-patterns.md, monthly/*.md, yearly/*.md.'
} else {
    foreach ($h in $LcredHits) {
        Write-Fail ("L: credential pattern '" + $h.pattern + "' found in " + $h.file + '.')
    }
}

# 7. Belt-and-suspenders.
Write-Info "L: install-task.ps1 was NOT invoked by verify. Scheduled tasks are never created by this script."
Write-Info "L: no git add / git commit / git push was executed. summarize itself does not touch git."

# =========================================================== M. doctor / output-index / package safety
Write-Section 'M. doctor / output-index / package safety'

# 1. Snapshot protected files.
$MprotectedPaths = @()
$Madd = @(
    (Join-Path $ProjectRoot 'README.md'),
    (Join-Path $ProjectRoot 'reports/dashboard.md'),
    (Join-Path $ProjectRoot 'data/tasks.json'),
    (Join-Path $ProjectRoot 'data/stats.json'),
    (Join-Path $ProjectRoot 'data/search.md'),
    (Join-Path $ProjectRoot 'data/index.json'),
    (Join-Path $ProjectRoot 'data/patterns.json'),
    (Join-Path $ProjectRoot 'reports/work-patterns.md'),
    (Join-Path $ProjectRoot 'reports/idea-log-inventory.md'),
    (Join-Path $ProjectRoot 'reports/source-scan-summary.json')
)
$journalForM = Join-Path $ProjectRoot 'journal'
if (Test-Path -LiteralPath $journalForM) {
    Get-ChildItem -LiteralPath $journalForM -File -Filter '*.md' -ErrorAction SilentlyContinue |
        ForEach-Object { $MprotectedPaths += $_.FullName }
}
foreach ($p in $Madd) { $MprotectedPaths += $p }
$MmonthlyDir = Join-Path $ProjectRoot 'reports\monthly'
if (Test-Path -LiteralPath $MmonthlyDir) {
    Get-ChildItem -LiteralPath $MmonthlyDir -File -Filter '*.md' -ErrorAction SilentlyContinue |
        ForEach-Object { $MprotectedPaths += $_.FullName }
}
$MyearlyDir = Join-Path $ProjectRoot 'reports\yearly'
if (Test-Path -LiteralPath $MyearlyDir) {
    Get-ChildItem -LiteralPath $MyearlyDir -File -Filter '*.md' -ErrorAction SilentlyContinue |
        ForEach-Object { $MprotectedPaths += $_.FullName }
}

$Mbefore = @{}
foreach ($p in $MprotectedPaths) { $Mbefore[$p] = Get-FileFingerprint $p }
Write-Info ("M: snapshotted " + $Mbefore.Count + " protected file(s).")

# 2. Run npm run doctor.
$MdoctorExit = Invoke-Step 'npm run doctor' { & $npmPath run doctor *>&1 | Out-Null }
if ($MdoctorExit -eq 0) {
    Write-Pass 'M: npm run doctor exited 0.'
} else {
    if ($Fresh) {
        Write-Warn ("M: npm run doctor exited $MdoctorExit (expected on empty data; -Fresh mode).")
    } else {
        Write-Fail ("M: npm run doctor exited $MdoctorExit.")
    }
}

# 3. Run npm run index:outputs.
$MindexExit = Invoke-Step 'npm run index:outputs' { & $npmPath run 'index:outputs' *>&1 | Out-Null }
if ($MindexExit -eq 0) {
    Write-Pass 'M: npm run index:outputs exited 0.'
} else { Write-Fail ("M: npm run index:outputs exited $MindexExit.") }

# 4. Run npm run package:local via Start-Process (avoids the $LASTEXITCODE
#    loss that happens when Invoke-Step wraps output streams). stdout/stderr
#    are also logged to reports/package-local-verify.log for debugging.
#    In -Fresh mode, package:local has nothing useful to package (no
#    journal/, no data/) and the dist/ zip would be a near-empty stub.
#    Skip the package step in that case but still run doctor +
#    index:outputs above.
if ($Fresh) {
    Write-Info 'M: -Fresh mode -> skipping npm run package:local. doctor + index:outputs still run above.'
    $MpkgExit = 0   # pretend success so the downstream checks don't fire
} else {
    $MpkgLogFile = Join-Path $ProjectRoot 'reports\package-local-verify.log'
    $psExe4Package = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $MpkgProc = Start-Process -FilePath $psExe4Package `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
            $PackageLocalScript) `
        -WorkingDirectory $ProjectRoot `
        -Wait -PassThru -NoNewWindow `
        -RedirectStandardOutput $MpkgLogFile `
        -RedirectStandardError ($MpkgLogFile + '.err')
    $MpkgExit = [int]$MpkgProc.ExitCode
    if ($MpkgExit -eq 0) {
        Write-Pass 'M: npm run package:local exited 0.'
    } else {
        Write-Fail ("M: npm run package:local exited $MpkgExit. Log: $MpkgLogFile")
        # Show first 20 lines of the log.
        if (Test-Path -LiteralPath $MpkgLogFile) {
            Get-Content -LiteralPath $MpkgLogFile -TotalCount 20 | ForEach-Object { Write-Host "  $_" }
        }
    }
}

# 5. Check output files exist.
$MdoctorMd   = Join-Path $ProjectRoot 'reports\doctor.md'
$MoutMd      = Join-Path $ProjectRoot 'reports\output-index.md'
$MoutJson    = Join-Path $ProjectRoot 'reports\output-index.json'
$MdistDir    = Join-Path $ProjectRoot 'dist'
$MzipPath    = Join-Path $MdistDir ("CodexJournal-Lite-v$ProjectVersion-local.zip")

if (Test-Path -LiteralPath $MdoctorMd) { Write-Pass 'M: reports/doctor.md exists.' } else { Write-Fail 'M: reports/doctor.md missing.' }
if (Test-Path -LiteralPath $MoutMd)    { Write-Pass 'M: reports/output-index.md exists.' } else { Write-Fail 'M: reports/output-index.md missing.' }
if (Test-Path -LiteralPath $MoutJson)  { Write-Pass 'M: reports/output-index.json exists.' } else { Write-Fail 'M: reports/output-index.json missing.' }
if (Test-Path -LiteralPath $MzipPath)  {
    Write-Pass ("M: dist/" + (Get-Item -LiteralPath $MzipPath).Name + " exists, size=" + (Get-Item -LiteralPath $MzipPath).Length + " bytes.")
} else {
    if ($Fresh) {
        Write-Warn ("M: dist/CodexJournal-Lite-v$ProjectVersion-local.zip missing (expected in -Fresh mode; package:local was skipped).")
    } else {
        Write-Fail ("M: dist/CodexJournal-Lite-v$ProjectVersion-local.zip missing.")
    }
}

# 6. Validate output-index.json via Node.js (synchronous, no PS depth issues).
if (Test-Path -LiteralPath $MoutJson) {
    $MjOutFile = Join-Path $env:TEMP 'verify-output-index-check.js'
    @"
const d=JSON.parse(require('fs').readFileSync('$($MoutJson -replace "\\","\\\\")','utf8'));
process.exit(d&&Array.isArray(d.files)&&d.files.length>0?0:1);
"@ | Set-Content -LiteralPath $MjOutFile -Force -Encoding UTF8
    & node $MjOutFile 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Pass 'M: reports/output-index.json is valid JSON with a non-empty files array.' }
    else { Write-Fail 'M: reports/output-index.json failed schema validation (expected .files array).' }
    Remove-Item -LiteralPath $MjOutFile -Force -ErrorAction SilentlyContinue
}

# 7. Zip exclusion check. Must FAIL (not WARN) if the archive cannot be
#    opened or if excluded items are found. Uses ZipFile.OpenRead which
#    is in the System.IO.Compression.FileSystem assembly (loadable in
#    Windows PowerShell 5.1 via Add-Type).
if (Test-Path -LiteralPath $MzipPath) {
    $zipBadItems = @()
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
        $za = [System.IO.Compression.ZipFile]::OpenRead($MzipPath)
        $zipEntries = $za.Entries
        foreach ($ze in $zipEntries) {
            if ($ze.FullName -match '\\') { $zipBadItems += "BACKSLASH_ENTRY: " + $ze.FullName }
            $n = $ze.FullName -replace '[/\\]', '/'
            if ($n -match 'data/index\.json') { $zipBadItems += $n }
            elseif ($n -match '(^|/)\.env')   { $zipBadItems += $n }
            elseif ($n -match 'node_modules/') { $zipBadItems += $n }
            elseif ($n -match '(^|/)\.git/')   { $zipBadItems += $n }
            elseif ($n -match 'reports/errors\.log') { $zipBadItems += $n }
            elseif ($n -match 'dist/.*\.zip$') { $zipBadItems += $n }
        }
        $za.Dispose()
    } catch {
        $zipBadItems += "EXCLUSION_CHECK_FAILED: " + $_.Exception.Message
    }
    if ($zipBadItems.Count -eq 0) {
        Write-Pass 'M: zip exclusion check passed (POSIX entry names; no data/index.json, .env, node_modules, .git, reports/errors.log, dist/*.zip).'
    } else {
        foreach ($b in $zipBadItems) { Write-Fail ("M: zip contains excluded item: " + $b) }
    }
}

# 8. Leak and credential check on new outputs.
$MnewFiles = @()
if (Test-Path -LiteralPath $MdoctorMd) { $MnewFiles += @{label='reports/doctor.md';path=$MdoctorMd} }
if (Test-Path -LiteralPath $MoutMd)    { $MnewFiles += @{label='reports/output-index.md';path=$MoutMd} }
if (Test-Path -LiteralPath $MoutJson)  { $MnewFiles += @{label='reports/output-index.json';path=$MoutJson} }

$Mleaks = @()
foreach ($src in $MnewFiles) {
    $text = [System.IO.File]::ReadAllText($src.path, [System.Text.Encoding]::UTF8)
    foreach ($u in $realUsersForK) {
        if (-not $u) { continue }
        $hits = [regex]::Matches($text, 'C:\\Users\\' + [regex]::Escape($u))
        if ($hits.Count -gt 0) { $Mleaks += [PSCustomObject]@{ file = $src.label; user=$u; count=$hits.Count } }
    }
}
if ($Mleaks.Count -eq 0) { Write-Pass 'M: new outputs contain no real Windows username path (UTF-8 byte-level).' }
else { foreach ($h in $Mleaks) { Write-Fail ("M: real username '" + $h.user + "' in " + $h.file) } }

$McredHits = @()
foreach ($src in $MnewFiles) {
    $text = [System.IO.File]::ReadAllText($src.path, [System.Text.Encoding]::UTF8)
    foreach ($pat in @('sk-[A-Za-z0-9_\-]{8,}','OPENAI_API_KEY\s*[:=]','Bearer\s+[A-Za-z0-9._\-/+=]{6,}')) {
        $m = [regex]::Matches($text, $pat); if ($m.Count -gt 0) { $McredHits += [PSCustomObject]@{file=$src.label;pattern=$pat} }
    }
}
if ($McredHits.Count -eq 0) { Write-Pass 'M: no real credential pattern found in new outputs.' }
else { foreach ($h in $McredHits) { Write-Fail ("M: credential pattern '" + $h.pattern + "' in " + $h.file) } }

# 9. Check protected files were not mutated.
$Mmutated = @()
foreach ($p in $MprotectedPaths) { $after=Get-FileFingerprint $p; if ($Mbefore[$p] -ne $after) { $Mmutated += $p.Replace($ProjectRoot.Path,'').TrimStart('\','/') } }
if ($Mmutated.Count -eq 0) { Write-Pass 'M: doctor / index:outputs / package:local did NOT modify any protected files.' }
else { foreach ($m in ($Mmutated|Select-Object -First 5)) { Write-Fail ("M: " + $m + " was mutated.") } }

# Belt-and-suspenders.
Write-Info "M: install-task.ps1 was NOT invoked by verify. Scheduled tasks are never created by this script."
Write-Info "M: no git add / git commit / git push was executed. doctor/index:outputs/package:local do not touch git."

# ============================================================ J. summary
function Write-Summary {
    $total = $script:passedCount + $script:failedCount + $script:warningCount
    Write-Host ''
    Write-Host ('-' * 60)
    Write-Host ('Total checks   : ' + $total)
    Write-Host ('  passed       : ' + $script:passedCount) -ForegroundColor Green
    Write-Host ('  failed       : ' + $script:failedCount) -ForegroundColor $(if ($script:failedCount -gt 0) { 'Red' } else { 'Green' })
    Write-Host ('  warnings     : ' + $script:warningCount) -ForegroundColor $(if ($script:warningCount -gt 0) { 'Yellow' } else { 'Green' })
    Write-Host ('-' * 60)
    if ($script:failedCount -eq 0) {
        Write-Host 'VERIFY PASSED' -ForegroundColor Green
    } else {
        Write-Host 'VERIFY FAILED' -ForegroundColor Red
    }
}

Write-Summary
if ($script:failedCount -eq 0) {
    exit 0
} else {
    exit 1
}
