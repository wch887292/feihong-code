# fhcode Skill CI Pipeline
# Usage: powershell -File .fhcode-ci/run-ci.ps1

$ErrorActionPreference = "Continue"
$skillsRoot = "H:\feihong-code\.fhcode\skills"
# Scan stable/ and beta/ subdirs; archive/ is excluded
$scanDirs = @("stable", "beta")

Write-Host "========================================"
Write-Host " fhcode Skill CI Pipeline"
Write-Host " Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "========================================"

$skillDirs = @()
foreach ($sd in $scanDirs) {
  $p = Join-Path $skillsRoot $sd
  if (Test-Path $p) { $skillDirs += Get-ChildItem $p -Directory }
}
$total = $skillDirs.Count
$pass = 0
$fail = 0
$warn = 0
$failList = @()
$warnList = @()

# Stage 1+3: schema + structure check
Write-Host "`n[Stage 1/3] Schema & Structure Check"
foreach ($dir in $skillDirs) {
  $skillName = $dir.Name
  $skillMd = Join-Path $dir.FullName "SKILL.md"

  if (-not (Test-Path $skillMd)) {
    Write-Host "  [FAIL] $skillName : SKILL.md missing"
    $fail++
    $failList += "$skillName : SKILL.md missing"
    continue
  }

  $content = Get-Content $skillMd -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
  $hasName = $content -match '(?m)^name:\s*\S+'
  $hasDesc = $content -match '(?m)^description:\s*\S+'

  if (-not $hasName -or -not $hasDesc) {
    $reason = @()
    if (-not $hasName) { $reason += "name missing" }
    if (-not $hasDesc) { $reason += "description missing" }
    Write-Host "  [FAIL] $skillName : $($reason -join ', ')"
    $fail++
    $failList += "$skillName : $($reason -join ', ')"
  } else {
    Write-Host "  [OK]   $skillName"
    $pass++
  }
}

# Stage 2: security scan
Write-Host "`n[Stage 2/3] Security Scan (hardcoded secrets)"
$secretPatterns = @(
  'sk-[a-zA-Z0-9]{20,}',
  'AKIA[A-Z0-9]{16}',
  'ghp_[a-zA-Z0-9]{30,}',
  'xox[baprs]-[a-zA-Z0-9-]{20,}',
  'BEGIN [A-Z ]*PRIVATE KEY'
)
$allFiles = Get-ChildItem $skillsRoot -Recurse -File -Include *.md,*.json,*.js,*.ts,*.py,*.yml,*.yaml -ErrorAction SilentlyContinue
$secretHits = @()
foreach ($pat in $secretPatterns) {
  $found = $allFiles | Select-String -Pattern $pat -ErrorAction SilentlyContinue
  if ($found) { $secretHits += $found }
}
# filter examples
$validHits = $secretHits | Where-Object {
  $l = $_.Line.Trim()
  $l -notmatch 'example|placeholder|your|xxx|YOUR_' -and
  $l -notmatch 'os\.environ|process\.env|getenv'
}

if ($validHits.Count -eq 0) {
  Write-Host "  [OK]   No hardcoded secrets found"
} else {
  Write-Host "  [FAIL] $($validHits.Count) hardcoded secret(s) found"
  foreach ($h in $validHits) {
    $rel = $h.Path.Replace($skillsRoot, '')
    Write-Host "         $rel :$($h.LineNumber)"
    $failList += "SECRET: $rel"
  }
  $fail += $validHits.Count
}

# Stage 3: file count sanity
Write-Host "`n[Stage 3/3] File Count Sanity"
foreach ($dir in $skillDirs) {
  $fileCount = (Get-ChildItem $dir.FullName -Recurse -File -ErrorAction SilentlyContinue).Count
  if ($fileCount -eq 0) {
    Write-Host "  [WARN] $($dir.Name) : empty directory"
    $warn++
    $warnList += "$($dir.Name) : empty"
  }
}

# Summary
Write-Host "`n========================================"
Write-Host " CI Summary"
Write-Host "========================================"
Write-Host " Total skills : $total"
Write-Host " Passed       : $pass"
Write-Host " Failed       : $fail"
Write-Host " Warnings     : $warn"

if ($fail -gt 0) {
  Write-Host "`nFAILED skills:"
  $failList | ForEach-Object { Write-Host "  - $_" }
  exit 1
} else {
  Write-Host "`nAll checks passed."
  exit 0
}
