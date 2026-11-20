# Remnawave 2.8.1 → RemnaDrop

Source confirmed by owner: unmodified Remnawave 2.8.1.
Automatic installation commands are in `INSTALL.md`. Use `install.sh` for a plain
2.8.1 installation and `install.sh /opt/remnawave --update` for a previous test fork.
The installer expects the existing remnawave/remnawave-db container names.

## Current schema

All 112 upstream Prisma migrations are preserved. Eight new migrations add quota,
webhook, metric history, CPU snapshot and alert tables, plus the transition from squad quotas to node quotas and detector settings.
UUIDs, users, credentials, squads, node settings and existing API tokens remain in
the same database. Never edit previously applied migrations.
Do not import users into a fresh panel or run `prisma migrate reset`/`db push`.

## Rehearsal (required before production)

1. Record the source image digest, Compose configuration, PostgreSQL version and
   mounted files. Back up `.env`, application secrets, certificates and configuration
   volumes securely. Preserve APP_SECRET and both JWT secrets exactly; generating
   new ones for the migrated installation may invalidate tokens/encrypted data.
2. Use a PostgreSQL client compatible with the source server. Set PGHOST, PGPORT,
   PGDATABASE and PGUSER for the source, and use a protected PGPASSFILE for the
   password. Do not put credentials into shell history or upload them.
3. Create a custom-format backup: `pg_dump --format=custom --file=before-upgrade.dump`.
   Inspect it with `pg_restore --list before-upgrade.dump`. This alone is not a
   restore test.
4. Export migration history:
   `psql -X -A -t -v ON_ERROR_STOP=1 -f backend/scripts/export-migration-history.sql -o history.json`.
   Run `node backend/scripts/migration-preflight.mjs history.json 2.8.1`.
   Failure requires investigation, not bypassing or rewriting the history table.
5. Restore the dump into a NEW isolated test database. Verify that the connection
   targets the test database before `pg_restore --exit-on-error --no-owner
   --no-privileges --dbname=TEST_DATABASE before-upgrade.dump`.
6. Restrict test-container egress to prevent interaction with production nodes,
   webhooks, Telegram and other external integrations. Restored settings contain
   real node addresses; merely using a different panel domain does not isolate them.
7. Against the test database, run `prisma migrate status` and `prisma migrate deploy`
   using the installed backend CLI. Never run `migrate dev` for an existing install.
   Compare Prisma's schema diff as well: the history checker validates history,
   not manual database schema drift.
8. Start the test API and workers only within the isolated environment. Verify
   admin login, existing API token, user UUIDs, subscriptions, squad memberships,
   traffic/expiry values and device records. Use dedicated test nodes for sync,
   traffic and reconnect checks. Record results before approving rollout.

The development Compose file uses a NEW volume and its own database credentials;
it is not a drop-in production migration configuration. Its seed step has not
been certified for an existing production database. Do not use it for rollout.

## Production cutover (after successful rehearsal)

Stop every source API, worker and scheduler to stop writes. Take a final database
dump plus configuration backup and export the final migration history. Preserve
the old image locally by digest. Change only the panel image/configuration needed
for the new release, keeping database, volumes, domain and secrets. Apply reviewed
migrations once, then start the new services. Verify the same smoke checks and
monitor logs. Never run old and new schedulers simultaneously against the database.

## Rollback

Run `rollback.sh` with the backup path printed by the installer. It restores the
matching final dump into a separate database and points the old services at it.
Restore configuration/secrets from the
same backup set. A restore loses writes made since the dump; define the rollback
window and acceptance of that loss before cutover. Keep the failed database for
analysis, do not overwrite the only backup.

Local container startup, SQL migrations and backup restoration have been checked.
The complete shell installer and rollback still need a target-server rehearsal.
The production release is not ready while critical/high dependency findings and
integration verification remain unresolved.
