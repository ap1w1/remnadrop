#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$(id -u)" == 0 ]] || { echo 'Run as root' >&2; exit 1; }
INSTALL_DIR=${1:-/opt/remnawave}
SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
for cmd in systemctl python3; do command -v "$cmd" >/dev/null || { echo "Missing $cmd" >&2; exit 1; }; done
install -d -m 0700 "$INSTALL_DIR/panel-updates" /opt/remnadrop-update-agent
install -m 0700 "$SOURCE/run.py" /opt/remnadrop-update-agent/run.py
cat >/etc/systemd/system/remnadrop-update.service <<SERVICE
[Unit]
Description=RemnaDrop panel update worker
Wants=docker.service
After=docker.service
[Service]
Type=oneshot
User=root
Group=root
UMask=0077
Environment=REMNADROP_UPDATE_DIR=$INSTALL_DIR/panel-updates
ExecStart=/usr/bin/python3 /opt/remnadrop-update-agent/run.py
TimeoutStartSec=8h
SERVICE
cat >/etc/systemd/system/remnadrop-update.timer <<'TIMER'
[Unit]
Description=Check RemnaDrop panel update requests
[Timer]
OnBootSec=15s
OnUnitInactiveSec=20s
Unit=remnadrop-update.service
[Install]
WantedBy=timers.target
TIMER
systemctl daemon-reload
systemctl enable --now remnadrop-update.timer
touch "$INSTALL_DIR/panel-updates/agent-ready"
echo 'Panel update worker installed.'
