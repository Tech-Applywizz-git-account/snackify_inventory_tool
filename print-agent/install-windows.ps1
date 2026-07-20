# Install Snackify print-agent as a Windows service (auto-start on boot).
# Run in PowerShell as Administrator:
#   Set-ExecutionPolicy -Scope Process Bypass
#   cd path\to\print-agent
#   .\install-windows.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServiceName = "SnackifyPrintAgent"

Write-Host "=== Snackify Print Agent - Windows installer ===" -ForegroundColor Cyan

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js not found. Install from https://nodejs.org (v18+)" -ForegroundColor Red
  exit 1
}

Set-Location $ScriptDir

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host ""
  Write-Host "Created .env. Edit it with your Supabase and printer settings, then run this script again." -ForegroundColor Yellow
  Write-Host "  notepad $ScriptDir\.env"
  exit 1
}

npm install --omit=dev
if ($LASTEXITCODE -ne 0) {
  Write-Host "npm install failed." -ForegroundColor Red
  exit 1
}

# Prefer NSSM if available; otherwise use PM2
$nssm = Get-Command nssm -ErrorAction SilentlyContinue

if ($nssm) {
  $nodePath = $node.Source
  $indexPath = Join-Path $ScriptDir "index.js"
  $stdoutPath = Join-Path $ScriptDir "agent.log"
  $stderrPath = Join-Path $ScriptDir "agent-error.log"

  & nssm stop $ServiceName 2>$null
  & nssm remove $ServiceName confirm 2>$null

  & nssm install $ServiceName $nodePath $indexPath
  & nssm set $ServiceName AppDirectory $ScriptDir
  & nssm set $ServiceName AppEnvironmentExtra "DOTENV_CONFIG_PATH=$ScriptDir\.env"
  & nssm set $ServiceName Start SERVICE_AUTO_START
  & nssm set $ServiceName AppStdout $stdoutPath
  & nssm set $ServiceName AppStderr $stderrPath
  & nssm start $ServiceName

  Write-Host ""
  Write-Host "=== Done (NSSM service) ===" -ForegroundColor Green
  Write-Host "Logs: $stdoutPath"
  Write-Host "Manage: nssm status $ServiceName"
} else {
  Write-Host ""
  Write-Host "NSSM not found. Using PM2 instead..." -ForegroundColor Yellow

  npm install -g pm2 pm2-windows-startup 2>$null
  pm2 delete snackify-print-agent 2>$null
  pm2 start index.js --name snackify-print-agent --cwd $ScriptDir
  pm2 save
  pm2-startup install 2>$null

  Write-Host ""
  Write-Host "=== Done (PM2) ===" -ForegroundColor Green
  Write-Host "Status: pm2 status"
  Write-Host "Logs:   pm2 logs snackify-print-agent"
  Write-Host ""
  Write-Host "Tip: For a proper Windows service, install NSSM from https://nssm.cc and re-run this script."
}

Write-Host ""
Write-Host "Print agent is running. It will auto-start on boot." -ForegroundColor Green
