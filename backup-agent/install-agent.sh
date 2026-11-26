#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$(id -u)" == 0 ]] || { echo 'Run as root' >&2; exit 1; }
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for cmd in docker systemctl python3; do command -v "$cmd" >/dev/null || { echo "Missing $cmd" >&2; exit 1; }; done
install -d -m 0700 /etc/remnadrop-backups /opt/remnadrop-backups /var/lib/remnadrop-backups/archives
install -m 0700 "$SOURCE/agent.py" /opt/remnadrop-backups/agent.py
if [[ ! -f /etc/remnadrop-backups/agent.env ]]; then
  install -m 0600 /dev/null /etc/remnadrop-backups/agent.env
  cat > /etc/remnadrop-backups/agent.env <<'ENV'
# Outgoing backup webhooks use the panel's standard webhook settings.
# RCLONE_CONFIG=/etc/remnadrop-backups/rclone.conf
# BACKUP_LOCAL_DIR=/var/lib/remnadrop-backups/archives
ENV
fi
cat >/etc/systemd/system/remnadrop-backups.service <<'SERVICE'
[Unit]
Description=RemnaDrop Backup Worker
Wants=docker.service
After=docker.service
[Service]
Type=oneshot
User=root
Group=root
UMask=0077
EnvironmentFile=-/etc/remnadrop-backups/agent.env
ExecStart=/usr/bin/python3 /opt/remnadrop-backups/agent.py
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/remnadrop-backups /run/lock
RuntimeDirectory=remnadrop-backups
TimeoutStartSec=8h
[Install]
WantedBy=multi-user.target
SERVICE
# Agent requires root-only Docker socket access; never expose the socket to the web app.
cat >/etc/systemd/system/remnadrop-backups.timer <<'TIMER'
[Unit]
Description=Check RemnaDrop backup schedules every minute
[Timer]
OnCalendar=*-*-* *:*:00
Persistent=true
Unit=remnadrop-backups.service
[Install]
WantedBy=timers.target
TIMER
systemctl daemon-reload
systemctl enable --now remnadrop-backups.timer
echo 'Backup worker installed. Configure remotes using rclone config and inspect:'
echo '  systemctl list-timers remnadrop-backups.timer'
echo '  journalctl -u remnadrop-backups.service -n 50 --no-pager'
