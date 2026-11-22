# RemnaDrop

Development fork of Remnawave 2.8.1. Exact upstream commits are recorded in
`upstream.lock.json`; backend and frontend remain separate Git repositories.
Both use branch `codex/remnadrop`. Original AGPL notices are retained.

## Local development

Requires Docker Compose v2. Run commands from this directory. This configuration
is for an isolated development database only.

1. Run `node init-dev.mjs` once to create `.env` and `backend/.env.dev` with
   random local secrets. Existing files are never overwritten.
2. Adjust local domains if using a reverse proxy. Compose overrides database
   and Redis addresses. Do not use these new secrets for a production migration.
3. Keep generated environment files private and out of source control.
4. Run `docker compose -f compose.dev.yml config --quiet`.
5. Run `docker compose -f compose.dev.yml build api`, then
   `docker compose -f compose.dev.yml up --no-build -d`.
6. Inspect `docker compose -f compose.dev.yml logs migrate api worker scheduler`.

API listens on localhost:3000. PostgreSQL, Redis and metrics have no published
ports. Database migration and seeding must finish before application processes
start. Docker build uses local frontend source, not the latest upstream binary.

This is a test image: it retains build dependencies. Validator WASM and schema
assets are bundled with checksums in `editor-assets.lock.json`; editor behavior
still needs browser acceptance testing.
Use `INSTALL.md` for installation and automatic migration from 2.8.1.

## Limiter and Cloudflare DNS

The **Tools** menu includes **Limiter** and **Cloudflare DNS** on desktop and
mobile. The image embeds upstream Limiter 5.1.0 in the existing panel container;
it starts only after credentials are configured and the administrator enables it.
Its default mode is manual. Cloudflare DNS requires an API token and zone/host
bindings before records can be changed. See
[`INTEGRATIONS_LIMITER_CLOUDFLARE.md`](INTEGRATIONS_LIMITER_CLOUDFLARE.md) for setup,
API scopes, webhook signing and integration checks.

The update preflight verifies both frontend routes, the Limiter executable and
CA certificates, and the integration migration in the built image before
switching the running panel. The upstream version label remains 2.8.1; the
RemnaDrop Git revision identifies these fork features.

## Verification

Use Node.js 24.22.3. In backend: `npm ci`, `npm run migrate:generate`,
`npm run build`, `npm run build:seed`. Prisma generation requires a syntactically
valid `DATABASE_URL` but does not migrate a database. In frontend: `npm ci`,
`npm run typecheck`, `npm run start:build` (the last command requires a POSIX
shell). CI runs builds and production dependency audits separately in each repo.

Existing UUIDs and API response models are preserved. New endpoints implement
node quotas, resets and metric history. `QUOTAS.md` describes quota semantics,
host template variables and signed webhooks. `MONITORING.md` describes historical
graphs, CSV, threshold notifications and the optional CPU agent. Torrent reports
include probable device attribution only for a single recent IP match.

Mixed node-version tests, live connection termination and external webhook delivery
still require validation on a test installation. Dependency audit findings remain;
this archive is not approved for production use. See `reports/acceptance.md`.

## Backup and rollback

For the existing unmodified Remnawave 2.8.1 installation, follow `MIGRATION.md`
and run the migration-history preflight before rehearsing on a database copy.

Before testing migrations on a copy of real data, create a PostgreSQL custom
format dump with `pg_dump -Fc` and verify it by restoring into a separate database.
Record application commit IDs and image digests with the dump. Never test a
rollback against the only copy. To roll back schema changes, stop application
writes and restore the matching dump into a fresh database, then start the
matching older images. Switching images alone does not undo migrations.

`docker compose -f compose.dev.yml down` preserves the development database.
Do not add `--volumes` unless intentionally discarding it.

## VPS management command

After importing the fork (main branch), install the CLI on the panel VPS:

```bash
cd /opt/remnadrop-git
git pull --ff-only origin main
sudo install -m 755 scripts/remnadrop-cli.sh /usr/local/bin/remnadrop
sudo remnadrop status
sudo remnadrop check
# For an approved production deployment, after staging tests:
sudo remnadrop update
```

- `status` reports the repository revision, the running panel's image tag and actual image ID, and health.
- `check` runs local upgrade preflight without downloading new revisions or restarting the panel.
- `update` pulls the latest private `main` with `--ff-only`, exports a pinned Git snapshot, builds a new Docker image, checks new frontend/migration files, exports the current container for rollback, backs up and test-restores PostgreSQL, runs reviewed migrations, then recreates only the panel and checks its image ID, health and HTTP response before reporting success. PostgreSQL and Redis are not recreated. The backup timer is then installed.
- A repeated update of the same Git revision still recreates the panel: matching image tags do not prove that the running container uses the current image. IDs are compared using the same Docker daemon, including its containerd image store when enabled.
- Compose paths are normalized without sorting, and repeated copies of the generated `compose.fork-auto.json` override are replaced by one entry at the end. Trailing LF/CRLF whitespace is handled; custom file order and repetitions are preserved. The next successful update repairs the existing managed duplicates automatically and saves `.panel-compose-files` only after deployment verification.
- Deployment regressions can be checked without a Docker daemon or production database: `python3 -m unittest discover -s tests -v`.
- The current production database is not automatically rolled back on errors. For production, rehearse on an isolated test system and retain the printed backup locations. Do not run an old image against a new schema without a verified rollback plan.
- The CLI assumes the previously installed RemnaDrop layout with `/opt/remnawave`, `remnawave`, `remnawave-db`, and `remnawave-redis`. A clean GitHub import by itself does not install or upgrade the running service.

