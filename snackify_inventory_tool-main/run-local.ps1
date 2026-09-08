# Applyways Pantry - One-shot local runner

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Step($msg) {
  Write-Host ""
  Write-Host "=== $msg ===" -ForegroundColor Cyan
}

function FailIfMissing($cmd, $hint) {
  $found = Get-Command $cmd -ErrorAction SilentlyContinue
  if (-not $found) {
    Write-Host "MISSING: $cmd" -ForegroundColor Red
    Write-Host $hint -ForegroundColor Yellow
    exit 1
  }
  Write-Host ("  {0,-10} -> {1}" -f $cmd, $found.Source)
}

Step "1. Checking prerequisites"
FailIfMissing "node" "Install Node.js 18+ from https://nodejs.org and re-run."
FailIfMissing "npm"  "npm comes with Node.js - reinstall Node from https://nodejs.org"
$nodeVer = (node --version)
Write-Host ("  node version: {0}" -f $nodeVer)
if ($nodeVer -match 'v(\d+)') {
  if ([int]$Matches[1] -lt 18) {
    Write-Host "Node 18+ required. Please update from https://nodejs.org" -ForegroundColor Red
    exit 1
  }
}

Step "2. Cleaning leftover broken folders"
foreach ($p in @('rtk-template')) {
  $full = Join-Path $root $p
  if (Test-Path $full) {
    Write-Host "  removing $p"
    try {
      Get-ChildItem $full -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
        try { $_.Attributes = 'Normal' } catch { }
      }
      Remove-Item $full -Recurse -Force
    } catch {
      Write-Host ("  WARN: could not remove {0}: {1}" -f $p, $_.Exception.Message) -ForegroundColor Yellow
    }
  }
}

Step "3. Supabase credentials"
$envBackend  = Join-Path $root 'backend\.env'
$envFrontend = Join-Path $root 'frontend\.env.local'

if ((Test-Path $envBackend) -and (Test-Path $envFrontend)) {
  Write-Host "  .env files already exist - using saved values."
  Write-Host "  Delete them and re-run to change keys."
} else {
  Write-Host "First-time setup. Get these from your Supabase project at:"
  Write-Host "  Project Settings -> API"
  Write-Host ""

  $supaUrl  = Read-Host "  Supabase Project URL (https://xxxxx.supabase.co)"
  $supaAnon = Read-Host "  Supabase anon public key (starts with eyJ...)"
  $supaSrv  = Read-Host "  Supabase service_role key (starts with eyJ...) KEEP SECRET"

  if (-not $supaUrl -or -not $supaAnon -or -not $supaSrv) {
    Write-Host "All three values required." -ForegroundColor Red
    exit 1
  }

  $backendEnv = @"
PORT=4000
NODE_ENV=development
SUPABASE_URL=$supaUrl
SUPABASE_SERVICE_ROLE_KEY=$supaSrv
ALLOWED_ORIGINS=http://localhost:5173
"@
  $frontendEnv = @"
VITE_SUPABASE_URL=$supaUrl
VITE_SUPABASE_ANON_KEY=$supaAnon
VITE_API_BASE_URL=http://localhost:4000
"@

  Set-Content -Path $envBackend  -Value $backendEnv  -Encoding UTF8
  Set-Content -Path $envFrontend -Value $frontendEnv -Encoding UTF8
  Write-Host "  wrote backend\.env and frontend\.env.local"
}

Step "4. Backend npm install"
Push-Location (Join-Path $root 'backend')
if (Test-Path 'node_modules') {
  Write-Host "  already installed (delete node_modules to reinstall)"
} else {
  npm install
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "backend npm install failed" }
}
Pop-Location

Step "5. Frontend npm install"
Push-Location (Join-Path $root 'frontend')
if (Test-Path 'node_modules') {
  Write-Host "  already installed (delete node_modules to reinstall)"
} else {
  npm install
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "frontend npm install failed" }
}
Pop-Location

Step "6. Launching dev servers"
$backendDir  = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'

Start-Process powershell -ArgumentList @(
  '-NoExit',
  '-Command',
  "Set-Location '$backendDir'; Write-Host '[BACKEND] http://localhost:4000' -ForegroundColor Green; npm run dev"
)

Start-Sleep -Seconds 2

Start-Process powershell -ArgumentList @(
  '-NoExit',
  '-Command',
  "Set-Location '$frontendDir'; Write-Host '[FRONTEND] http://localhost:5173' -ForegroundColor Green; npm run dev"
)

Start-Sleep -Seconds 4

Step "7. Opening browser"
Start-Process "http://localhost:5173"

Write-Host ""
Write-Host "All systems go." -ForegroundColor Green
Write-Host "  Backend:  http://localhost:4000  (separate window)"
Write-Host "  Frontend: http://localhost:5173  (separate window)"
Write-Host ""
Write-Host "Next: sign in with magic link, then promote yourself to leadership"
Write-Host "(see README for the SQL command)."
