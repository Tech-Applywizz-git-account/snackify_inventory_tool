# Snackify Office LAN Print Gateway

This folder is the office-side gateway for the Render/backend -> Supabase -> LAN printer workflow.

The gateway reuses `../print-agent/index.js` unchanged. It listens to Supabase for:

- Guest cafeteria meal jobs in `meal_print_jobs`
- Cafeteria token purchases in `token_usage`
- Normal pantry print orders

The gateway must run on a computer, VM, or Raspberry Pi that can reach the thermal printer over the office LAN. Render does not need direct access to the printer; it only needs to write the Supabase rows that this gateway consumes.

Receipt design settings are stored in Supabase and edited by leadership users in the Vercel admin dashboard. The schema, defaults, migration draft, and validation code are all in this folder. Apply `receipt-design-migration.sql` in the Supabase SQL editor before using the dashboard controls, then deploy the backend/frontend changes and restart this gateway.

## Linux installation

```bash
cd office-print-gateway
cp .env.example .env
nano .env
npm run install-agent
npm run test-print
npm install -g pm2
pm2 delete snackify-office-print-gateway
pm2 start gateway.js --name snackify-office-print-gateway --cwd "$(pwd)"
pm2 save
pm2 startup
```

Run the `sudo` command printed by `pm2 startup`, then run:

```bash
pm2 save
pm2 status
pm2 logs snackify-office-print-gateway
```

After an admin saves a receipt design, the running gateway reloads it within 15 seconds. A restart is not required, but it is safe:

```bash
pm2 restart snackify-office-print-gateway
```

## Windows installation

Run PowerShell as Administrator:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
Set-Location "C:\path\to\snackify_inventory_tool\office-print-gateway"
Copy-Item .env.example .env
notepad .env
npm run install-agent
npm run test-print
npm install -g pm2 pm2-windows-startup
pm2 delete snackify-office-print-gateway
pm2 start gateway.js --name snackify-office-print-gateway --cwd (Get-Location).Path
pm2 save
pm2-startup install
pm2 status
```

Run the contract tests from this folder:

```bash
npm run test-design
```

## Network check

From the gateway machine, verify that the printer's raw TCP port is reachable:

```bash
nc -vz 192.168.1.100 9100
```

Do not expose port `9100` to the public internet. Connect the gateway machine to the office LAN or to it through a private VPN.