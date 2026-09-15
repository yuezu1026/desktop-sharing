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
         - git add <docs .editorconfig .prettierignore .vscode .gitignore>
         - git commit -F <msgfile>
         - print the short hash

  USAGE
    # dry run: run both gates only
    powershell -NoProfile -File docs\design\wireframe\tools\round-close.ps1 -MsgFile .\.git-msg.txt

    # full close-out
    powershell -NoProfile -File docs\design\wireframe\tools\round-close.ps1 -MsgFile .\.git-msg.txt -Commit

  NOTES
    - Exit code: 0 = all good, 1 = a gate failed or git failed.
    - This repo has NO remote: the script never pushes and never probes a proxy.
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

Write-Step "git add"
$targets = @('docs', '.editorconfig', '.prettierignore', '.vscode', '.gitignore') |
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
  Write-Host "no remote configured -> nothing to push."
}
finally {
  Pop-Location
}
exit 0
