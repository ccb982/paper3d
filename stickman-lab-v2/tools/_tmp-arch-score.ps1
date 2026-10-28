$ErrorActionPreference = "Continue"
$cands = @("10234685","88ac1714","73eaf438","5930f3f9","9d657f8b")
foreach ($c in $cands) {
  Write-Output "======== CAND $c ========"
  git checkout $c -- src/ 2>&1 | Out-Null
  $out = node tools/run.mjs _tmp-facts 2>&1 | Out-String
  $lines = $out -split "`r?`n"
  $inBlock = $false
  foreach ($ln in $lines) {
    if ($ln -match "默认") { $inBlock = $true; continue }
    if ($inBlock -and $ln -match "关被动刚度") { break }
    if ($inBlock -and ($ln -match "^  (hip|knee|foot)")) { Write-Output $ln }
  }
  $ab = node tools/run.mjs _tmp-ab 2>&1 | Out-String
  $ab -split "`r?`n" | Where-Object { $_ -match "^ (当前默认)" } | ForEach-Object { Write-Output $_ }
}
git checkout game-remake -- src/ 2>&1 | Out-Null
Write-Output "======== restored game-remake ========"
