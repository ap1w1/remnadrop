# Monitoring

Open Управление → Мониторинг → Просмотр and select up to 20 nodes and a period of up to 90 days.
The scheduler collects samples every minute. Graph buckets contain averages and
are limited to approximately 600 points per node. CSV exports the same selected
data. Missing samples remain null, not zero. Traffic counters are cumulative since
node/interface startup and may reset. Availability describes the panel connection.

CPU percentage requires the bundled Linux agent; load averages are separate metrics.
The migration script creates a private `NODE_METRICS_SECRET` automatically.
For manual deployments, set a random secret of at least 32 characters in the API
environment. Each node receives its own derived bearer token. Changing the secret
revokes all node agent tokens. Tokens authorize CPU submission only.

## Install the CPU agent on each Linux node

Copy `node-metrics-agent.py` to `/opt/node-metrics-agent.py`. On the metrics page,
select exactly one node and copy its token. Create `/etc/node-metrics-agent.env`
with mode 600, replacing the three values below:

```ini
PANEL_URL=https://panel.example.com
NODE_UUID=uuid-of-this-node
NODE_METRICS_TOKEN=token-copied-from-panel
```

Create `/etc/systemd/system/node-metrics-agent.service`:

```ini
[Unit]
Description=Node CPU metrics
After=network-online.target
Wants=network-online.target
[Service]
EnvironmentFile=/etc/node-metrics-agent.env
ExecStart=/usr/bin/python3 /opt/node-metrics-agent.py
Restart=always
RestartSec=10
DynamicUser=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
[Install]
WantedBy=multi-user.target
```

```bash
sudo chmod 600 /etc/node-metrics-agent.env
sudo systemctl daemon-reload
sudo systemctl enable --now node-metrics-agent
```

The first CPU sample arrives after one minute. If submissions stop for two minutes,
CPU becomes unavailable. HTTPS verification is mandatory; redirects are rejected.

## Detector settings

Управление → Мониторинг → Настройки → Детектор падений contains global rules and
per-node overrides. Nodes inherit global rules until an individual rule is saved;
“Использовать общие настройки” removes that override. Detection is disabled by
default. Configure online/combined traffic drop percentages, CPU/RAM thresholds,
the rolling baseline window, confirmation minutes and minimum baseline activity.
Empty thresholds disable individual conditions. Drops require three prior samples.
Missing data is not zero and interrupts confirmation. CPU requires the agent.
The Просмотр page shows the latest 100 threshold/recovery events. For external
delivery enable the standard Remnawave webhook settings (`WEBHOOK_ENABLED`,
`WEBHOOK_URL`, `WEBHOOK_SECRET_HEADER`). Detector settings are stored
in PostgreSQL, replacing the previous environment-only threshold configuration.

The original Metrics page is unchanged. DPI Checker is a separate placeholder
that displays “Раздел в разработке”.
