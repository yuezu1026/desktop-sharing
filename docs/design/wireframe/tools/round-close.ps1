<#
  round-close.ps1 -- "one round of wireframe edits" close-out script (anti-drift, part F)

  WHY THIS FILE IS PURE ASCII:
    PowerShell 5.1 decodes a .ps1 that has no BOM as GBK. Any Chinese literal in
    this file would then be mangled and raise a ParserError. The only Chinese
    content needed here is the commit message, so it lives in a separate UTF-8
    file passed with -MsgFile.

  WHAT IT DOES (in order):
    1. geometry gate      : node tools/wireframe-selfcheck.mjs
    2. consistency gate   : node tools/wireframe-consistency.mjs
                            (counts / canvas ledger / L### refs / section refs /
                             controlled-end red line)
    3. only if BOTH gates exit 0 and -Commit was given:
         - normalize -MsgFile to UTF-8 WITHOUT BOM (a BOM would end up inside the
           commit subject on GitHub) and verify the first three bytes
         - write .rounds/last.md (a ~300 token re-entry snapshot for the NEXT
           chat session; see "progressive disclosure" in AGENTS.md)
         - git add <AGENTS.md docs .github .editorconfig .prettierignore .vscode .gitignore .rounds>
         - git commit -F <msgfile>
         - git push -u origin HEAD  (desktop-sharing only; never --force)
         - print the short hash

  USAGE
    # dry run: run both gates only
    powershell -NoProfile -File docs\design\wireframe\tools\round-close.ps1 -MsgFile .\.git-msg.txt

    # full close-out
    powershell -NoProfile -File docs\design\wireframe\tools\round-close.ps1 -MsgFile .\.git-msg.txt -Commit

  NOTES
    - Exit code: 0 = all good, 1 = a gate failed or git failed.
    - After a successful commit, push HEAD to origin
      https://github.com/yuezu1026/desktop-sharing (never --force, never probe a proxy).
    - The message file is NOT deleted, so you can inspect what was committed; it is
      listed in the root .gitignore so it can never be staged by accident.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$MsgFile,
  [switch]$Commit,
  [switch]$SkipGates
)

$ErrorActionPreference = 'Continue'

function Write-Step([string]$text) {
  Write-Host ""
  Write-Host ("=== " + $text + " ===")
}

# ---------------------------------------------------------------- locate root
$wireframe = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path   # docs\design\wireframe
$root = (Resolve-Path (Join-Path $wireframe '..\..\..')).Path    # repo root

Write-Host ("repo root : " + $root)
Write-Host ("wireframe : " + $wireframe)

# ------------------------------------------------------------------- 1+2 gates
$failed = @()
$rc1 = $null
$rc2 = $null

if (-not $SkipGates) {
  Push-Location $wireframe
  try {
    Write-Step "gate 1/2 : geometry (wireframe-selfcheck.mjs)"
    & node 'tools/wireframe-selfcheck.mjs'
    $rc1 = $LASTEXITCODE
    Write-Host ("exit code : " + $rc1)
    if ($rc1 -ne 0) { $failed += 'selfcheck' }

    Write-Step "gate 2/2 : consistency (wireframe-consistency.mjs)"
    & node 'tools/wireframe-consistency.mjs'
    $rc2 = $LASTEXITCODE
    Write-Host ("exit code : " + $rc2)
    if ($rc2 -ne 0) { $failed += 'consistency' }
  }
  finally {
    Pop-Location
  }
}
else {
  Write-Host "gates skipped (-SkipGates)"
}

if ($failed.Count -gt 0) {
  Write-Step "BLOCKED"
  Write-Host ("gate(s) failed : " + ($failed -join ', '))
  Write-Host "read the machine-readable detail :"
  Write-Host ("  " + (Join-Path $wireframe 'tools\selfcheck-report.json'))
  Write-Host ("  " + (Join-Path $wireframe 'tools\consistency-report.json'))
  Write-Host "commit refused (do not pass -Commit until both exit 0)."
  exit 1
}

if (-not $Commit) {
  Write-Step "DRY RUN"
  Write-Host "both gates are clean. re-run with -Commit to commit."
  exit 0
}

# ------------------------------------------------------- 3 commit (BOM safe)
if (-not (Test-Path -LiteralPath $MsgFile)) {
  Write-Step "BLOCKED"
  Write-Host ("message file not found : " + $MsgFile)
  exit 1
}
$msgPath = (Resolve-Path -LiteralPath $MsgFile).Path

Write-Step "normalize commit message (UTF-8, no BOM)"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$text = [System.IO.File]::ReadAllText($msgPath, [System.Text.Encoding]::UTF8)
if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
[System.IO.File]::WriteAllText($msgPath, $text, $utf8NoBom)

$bytes = [System.IO.File]::ReadAllBytes($msgPath)
$bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)
Write-Host ("first bytes : " + (($bytes[0..([Math]::Min(2, $bytes.Length - 1))]) -join ','))
if ($bom) {
  Write-Host "BLOCKED: message file still starts with a UTF-8 BOM"
  exit 1
}
Write-Host "message file is BOM-free UTF-8  [ok]"

# ------------------------------------------------- 4 snapshot (.rounds/last.md)
# WHY: the next chat session has no memory of this round. This tiny file is the
# cheapest possible re-entry point (progressive disclosure, level L0.5): what
# changed, what the gates said, and where to look next. Chinese text is fine
# here because the file is written with File.WriteAllText, never through the
# console (PS 5.1 console encoding is GBK and would mangle it).
Write-Step "snapshot (.rounds/last.md)"

# changed paths: read git output as UTF-8, otherwise non-ASCII paths get mangled
$prevEnc = [Console]::OutputEncoding
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $changed = @(& git -C $root status --short)
}
finally {
  [Console]::OutputEncoding = $prevEnc
}

$truthLine = '(no report)'
$reportPath = Join-Path $wireframe 'tools\consistency-report.json'
if (Test-Path -LiteralPath $reportPath) {
  try {
    $rep = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $truthLine = ($rep.truth | ConvertTo-Json -Compress)
  }
  catch { $truthLine = '(report unreadable)' }
}

$gate1 = if ($null -eq $rc1) { 'skipped' } else { $rc1 }
$gate2 = if ($null -eq $rc2) { 'skipped' } else { $rc2 }
$subject = ($text -split "`r?`n")[0]

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('# Round snapshot (auto-generated by tools/round-close.ps1 -- do not edit)')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('- when    : ' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))
[void]$sb.AppendLine('- message : ' + $subject)
[void]$sb.AppendLine('- gates   : selfcheck=' + $gate1 + '  consistency=' + $gate2)
[void]$sb.AppendLine('- truth   : ' + $truthLine)
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Changed paths (' + $changed.Count + ')')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('```')
foreach ($line in $changed) { [void]$sb.AppendLine($line) }
[void]$sb.AppendLine('```')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Where to look next')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('- L1 doc map  : docs/OUTLINE.md')
[void]$sb.AppendLine('- name card   : AGENTS.md')
[void]$sb.AppendLine('- gate detail : docs/design/wireframe/tools/consistency-report.json')

$snapshotDir = Join-Path $root '.rounds'
if (-not (Test-Path -LiteralPath $snapshotDir)) {
  New-Item -ItemType Directory -Path $snapshotDir | Out-Null
}
$snapshotPath = Join-Path $snapshotDir 'last.md'
[System.IO.File]::WriteAllText($snapshotPath, $sb.ToString(), $utf8NoBom)
Write-Host ('wrote : ' + $snapshotPath)
Write-Host ('changed paths : ' + $changed.Count)

Write-Step "git add"
$targets = @('AGENTS.md', 'docs', '.github', '.cursor', '.editorconfig', '.prettierignore', '.vscode', '.gitignore', '.rounds', 'crates', 'services', 'apps', 'deploy') |
  Where-Object { Test-Path -LiteralPath (Join-Path $root $_) }
Push-Location $root
try {
  & git add -- @targets 2>&1 | ForEach-Object { Write-Host $_ }
  $rcAdd = $LASTEXITCODE
  Write-Host ("git add exit : " + $rcAdd)
  if ($rcAdd -ne 0) { Write-Host "BLOCKED: git add failed"; exit 1 }

  Write-Step "git commit"
  & git commit -F $msgPath 2>&1 | ForEach-Object { Write-Host $_ }
  $rcCommit = $LASTEXITCODE
  Write-Host ("git commit exit : " + $rcCommit)
  if ($rcCommit -ne 0) { Write-Host "BLOCKED: git commit failed"; exit 1 }

  $hash = (& git rev-parse --short HEAD)
  Write-Host ""
  Write-Host ("committed : " + $hash)

  Write-Step "git push"
  $originUrl = "https://github.com/yuezu1026/desktop-sharing.git"
  $hasOrigin = $false
  & git remote get-url origin 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $hasOrigin = $true }
  if (-not $hasOrigin) {
    & git remote add origin $originUrl
    if ($LASTEXITCODE -ne 0) { Write-Host "BLOCKED: git remote add failed"; exit 1 }
  }
  $currentUrl = (& git remote get-url origin).Trim()
  if ($currentUrl -ne $originUrl -and $currentUrl -ne "https://github.com/yuezu1026/desktop-sharing") {
    Write-Host "BLOCKED: origin is not the desktop-sharing repo"
    Write-Host $currentUrl
    exit 1
  }
  & git push -u origin HEAD 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { Write-Host "BLOCKED: git push failed"; exit 1 }
  Write-Host "pushed : origin HEAD"
}
finally {
  Pop-Location
}
exit 0
