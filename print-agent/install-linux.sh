#!/usr/bin/env bash
# Install Snackify print-agent as a systemd service on Raspberry Pi / Linux.
# Usage: chmod +x install-linux.sh && ./install-linux.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="snackify-print-agent"
NODE_BIN="$(command -v node || true)"

echo "=== Snackify Print Agent — Linux installer ==="

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js not found. Install Node 18+ first:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "  sudo apt-get install -y nodejs"
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "Node.js 18+ required (found $($NODE_BIN -v))"
  exit 1
fi

cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo ""
  echo "Created .env from .env.example — edit it now:"
  echo "  nano $SCRIPT_DIR/.env"
  echo ""
  echo "Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PRINTER_IP"
  exit 1
fi

npm install --omit=dev

echo ""
echo "Running test print..."
node test-print.js || {
  echo ""
  echo "Test print failed. Fix PRINTER_IP in .env, then run: node test-print.js"
  exit 1
}

UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
sudo tee "$UNIT_FILE" > /dev/null <<EOF
[Unit]
Description=Snackify thermal print agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$SCRIPT_DIR
EnvironmentFile=$SCRIPT_DIR/.env
ExecStart=$NODE_BIN $SCRIPT_DIR/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo ""
echo "=== Done ==="
echo "Service: $SERVICE_NAME"
echo "Status:  sudo systemctl status $SERVICE_NAME"
echo "Logs:    sudo journalctl -u $SERVICE_NAME -f"
echo ""
echo "Print agent is running. It will auto-start on boot."
