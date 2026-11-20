# Installation and upgrade

Upload `remnadrop-source.tar.gz` to `/root/` on the panel server, then:

```bash
sudo mkdir -p /opt/panel-build
sudo tar -xzf /root/remnadrop-source.tar.gz -C /opt/panel-build
cd /opt/panel-build/remnadrop
```

For an unmodified Remnawave **2.8.1** installation:

```bash
sudo bash ./install.sh /opt/remnawave
```

For the previously installed development fork based on **2.8.1**:

```bash
sudo bash ./install.sh /opt/remnawave --update
```

Both commands build the image before stopping the panel, check migration history,
stop application writes, back up the database and Compose configuration, verify
the backup by restoring it into a separate temporary database, apply migrations,
and start API, processor and scheduler. UUIDs, passwords and signing keys from the
existing installation are preserved. No database seed is run during an upgrade.
PostgreSQL and Redis containers must be named `remnawave-db` and `remnawave-redis`,
and the panel container and Compose service must be named `remnawave`.
Custom installations are not automatically detected beyond Compose configuration.

Allow several minutes for compilation. A 2 GB machine requires additional swap
or an image built elsewhere. Build failures leave the running panel unchanged.
Migration failures stop the panel and print the backup location; do not restart an
older image against a partially upgraded schema.

After successful installation:

```bash
export COMPOSE_FILE="$(cat /opt/remnawave/.panel-compose-files)"
docker compose --project-directory /opt/remnawave ps
docker logs --tail=100 remnawave
```

Use the saved `COMPOSE_FILE` for future Compose operations so the fork override is
included. The existing reverse proxy and domain remain in use.

## Rollback

Use the exact backup path printed by the installer:

```bash
sudo bash ./rollback.sh /opt/remnawave/migration-backups/TIMESTAMP
```

Rollback restores the snapshot into a **new database** and starts the saved old
image with that database. The current database is preserved. Changes made after
the snapshot will not appear in the restored panel. Keep the backup directory and
old image until acceptance testing is complete. Configuration backups contain
secrets and must remain private.

See `QUOTAS.md` for limits and webhook configuration and `MONITORING.md` for CPU
agent installation. Test node access and subscription generation before rollout
to real users.
