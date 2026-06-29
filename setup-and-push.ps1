# Applyways Pantry — One-shot Git setup + push to GitHub
#
# Run this from PowerShell, in the C:\Users\DELL\Desktop\inventory folder:
#
#   cd C:\Users\DELL\Desktop\inventory
#   powershell -ExecutionPolicy Bypass -File .\setup-and-push.ps1
#
# What it does:
#   1. Force-deletes the two broken .git folders the sandbox left behind
#   2. Initializes a fresh git repo on the 'main' branch
#   3. Commits everything (excluding rtk-template via .gitignore)
#   4. Adds your GitHub repo as 'origin'
#   5. Pushes — Git Credential Manager will pop a browser to authenticate

$ErrorActionPreference = 'Stop'
$repoUrl = 'https://github.com/GOODBOYKITTU272/Inventory.git'

Write-Host '=== 1. cleaning up leftover .git folders ==='
foreach ($p in @('.git', 'rtk-template')) {
  if (Test-Path $p) {
    Write-Host "  removing $p"
    # Force-clear read-only flags first, then recursive delete
    try {
      Get-ChildItem $p -Recurse -Force | ForEach-Object { $_.Attributes = 'Normal' }
    } catch { }
    Remove-Item $p -Recurse -Force -ErrorAction Stop
  } else {
    Write-Host "  $p not present (already clean)"
  }
}

Write-Host ''
Write-Host '=== 2. git init ==='
git init -b main
if ($LASTEXITCODE -ne 0) { throw 'git init failed' }

Write-Host ''
Write-Host '=== 3. git config (local repo only) ==='
git config user.email 'chandaramakrishna2013@gmail.com'
git config user.name 'kittu'

Write-Host ''
Write-Host '=== 4. git add . ==='
git add .

Write-Host ''
Write-Host '=== 5. git status (staged files) ==='
git status --short

Write-Host ''
Write-Host '=== 6. git commit ==='
git commit -m @'
Initial scaffold: Applyways Pantry Phase 1 MVP

- Supabase schema (products, inventory, transactions) + RLS + views
- 34-product seed catalog
- Express API with auth, role guards, bulk daily-update endpoint
- React+Vite+Tailwind UI: login, dashboard, daily-update, finance, staff view
- Playwright e2e scaffolding
- README + GETTING_STARTED with MCP install instructions
'@

Write-Host ''
Write-Host '=== 7. git remote add origin ==='
git remote add origin $repoUrl

Write-Host ''
Write-Host '=== 8. git push -u origin main ==='
Write-Host 'A browser window may open for GitHub authentication. Approve it to continue.'
git push -u origin main

Write-Host ''
Write-Host '=== done. ==='
Write-Host "Pushed to $repoUrl"
Write-Host 'Open it in your browser to verify:'
Write-Host '  https://github.com/GOODBOYKITTU272/Inventory'
