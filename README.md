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
