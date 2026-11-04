# Full local verification for divan-analytic (Windows PowerShell 5.1+).
# Usage (from the project folder):
#   powershell -ExecutionPolicy Bypass -File scripts\verify.ps1
# Writes the full log to .verify\report.txt (git-ignored). Secrets are never printed.
# WARNING: resets the LOCAL Supabase database (npm run db:reset).

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:FORCE_COLOR = "0"
$env:NO_COLOR = "1"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDir = Join-Path $root ".verify"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "report.txt"
"" | Out-File -FilePath $log -Encoding utf8

$results = [ordered]@{}

function Write-Log([string]$text) {
  Write-Host $text
  $text | Out-File -FilePath $log -Append -Encoding utf8
}

function Run-Step([string]$name, [scriptblock]$block) {
  Write-Log ""
  Write-Log "===== STEP: $name ====="
  $started = Get-Date
  $global:LASTEXITCODE = 0
  $out = & $block 2>&1 | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  $out | ForEach-Object { Write-Host $_ }
  $out | Out-File -FilePath $log -Append -Encoding utf8
  $secs = [int]((Get-Date) - $started).TotalSeconds
  $status = if ($code -eq 0) { "PASS" } else { "FAIL (exit $code)" }
  Write-Log "===== RESULT: $name -> $status in ${secs}s ====="
  $results[$name] = $status
  return ($code -eq 0)
}

function Read-EnvLocal([string]$key) {
  $line = Select-String -Path (Join-Path $root ".env.local") -Pattern "^$key=(.+)$" | Select-Object -First 1
  if ($line) { return $line.Matches[0].Groups[1].Value.Trim() }
  return $null
}

function Wait-Url([string]$url, [int]$seconds) {
  for ($i = 0; $i -lt $seconds; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Invoke-Sync([string]$label, [string]$secret) {
  Write-Log "--- sync call: $label"
  try {
    $resp = Invoke-RestMethod -Method Post -Uri "http://localhost:3200/api/internal/jobs/sync" `
      -Headers @{ Authorization = "Bearer $secret" } -TimeoutSec 90
    Write-Log ($resp | ConvertTo-Json -Depth 6)
    return $true
  } catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    Write-Log "sync request failed: HTTP $status $($_.Exception.Message)"
    return $false
  }
}

function Test-Sync([string]$provider) {
  $name = "sync ($provider)"
  Write-Log ""
  Write-Log "===== STEP: $name ====="
  $secret = Read-EnvLocal "CRON_SECRET"
  if (-not $secret) {
    Write-Log "CRON_SECRET not found in .env.local"
    $results[$name] = "SKIPPED"
    return
  }

  $env:APP_DATA_MODE = "connected"
  $env:SPORTS_PROVIDER = $provider
  $proc = Start-Process -FilePath "npx.cmd" -ArgumentList "next", "start", "-p", "3200" `
    -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir "server-$provider.out.txt") `
    -RedirectStandardError (Join-Path $logDir "server-$provider.err.txt")
  try {
    if (-not (Wait-Url "http://localhost:3200/api/health" 90)) {
      Write-Log "server did not start; see .verify\server-$provider.err.txt"
      $results[$name] = "FAIL (server)"
      return
    }
    $ok1 = Invoke-Sync "first run" $secret
    $ok2 = Invoke-Sync "second run (must not duplicate)" $secret
    Write-Log "--- local DB summary"
    $counts = & node scripts/verify-db-counts.mjs 2>&1 | ForEach-Object { "$_" }
    $counts | ForEach-Object { Write-Log $_ }
    $results[$name] = if ($ok1 -and $ok2) { "DONE (see output)" } else { "FAIL (request)" }
  } finally {
    & taskkill /PID $proc.Id /T /F 2>&1 | Out-Null
    Remove-Item Env:SPORTS_PROVIDER -ErrorAction SilentlyContinue
    Remove-Item Env:APP_DATA_MODE -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
}

Write-Log "divan-analytic verify: $(Get-Date -Format s)"
Write-Log "node: $(node -v)"
Write-Log "git: $(git log --oneline -1)"

# --- Docker
& docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Log "Docker is not running, trying to start Docker Desktop..."
  $dd = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if (Test-Path $dd) { Start-Process $dd | Out-Null }
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 3
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) { break }
  }
}
& docker info *> $null
$dockerOk = ($LASTEXITCODE -eq 0)
Write-Log "docker running: $dockerOk"

if ($dockerOk) {
  $dbUp = Run-Step "db:start" { npm run db:start }
  if ($dbUp) {
    $reset = Run-Step "db:reset" { npm run db:reset }
    if ($reset) {
      Run-Step "db:test" { npm run db:test } | Out-Null
      Run-Step "test:integration" { npm run test:integration } | Out-Null
      Run-Step "db:test (again, order independence)" { npm run db:test } | Out-Null
    }
  }
} else {
  $results["database"] = "SKIPPED (Docker not running)"
}

# Stale .next/types can reference routes that were moved or removed; the build recreates them.
if (Test-Path (Join-Path $root ".next")) {
  Remove-Item -Recurse -Force (Join-Path $root ".next") -ErrorAction SilentlyContinue
  Write-Log "removed stale .next build output"
}

Run-Step "check (format, lint, typecheck, unit)" { npm run check } | Out-Null
$built = Run-Step "build" { npm run build }
Run-Step "e2e" { npm run e2e } | Out-Null

if ($built -and $dockerOk) {
  Test-Sync "fixtures"
  if (Read-EnvLocal "FOOTBALL_DATA_API_KEY") {
    Write-Log "waiting 65s so the provider budget window resets..."
    Start-Sleep -Seconds 65
    Test-Sync "football-data"
  } else {
    $results["sync (football-data)"] = "SKIPPED (no FOOTBALL_DATA_API_KEY)"
  }
}

Write-Log ""
Write-Log "===== SUMMARY ====="
foreach ($k in $results.Keys) { Write-Log ("{0,-45} {1}" -f $k, $results[$k]) }
Write-Log "Full log: .verify\report.txt"
