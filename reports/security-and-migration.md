# Security and migration checkpoint

Source confirmed by owner: unmodified Remnawave 2.8.1.

## Dependency changes

Targeted compatible backend updates changed 10 packages, including Axios 1.21.1,
proxy-addr 2.0.8 and body-parser 2.4.0. Original package.json ranges are preserved;
the exact resolved changes are recorded in package-lock.json.

Production npm audit decreased from 32 findings (1 critical, 28 high,
3 moderate) to 25 (0 critical, 24 high, 1 moderate). Findings for Axios,
body-parser, compression, follow-redirects, morgan, proxy-addr and qs are no
longer present. See backend-audit-after.json. This is not a complete security
clearance. Frontend has not changed in this checkpoint.

## Validation

- Backend Nest build passed after dependency updates.
- 10 Node tests passed: migration history validation and trusted proxy behavior.
- All 112 preserved SQL migration files match upstream checksums after LF
  normalization. The checker compares exported database checksums to exact
  upstream Git bytes, without changing existing migration history.
- Added migration tests to CI alongside build/audit gates.

## Migration artifacts

See ../MIGRATION.md, backend/scripts/export-migration-history.sql and
backend/scripts/migration-preflight.mjs (paths relative to the project root).
The preflight is read-only and checks history, not database schema drift.
No new schema migration is necessary for the current dependency-only changes.
Future feature schema changes must use additive migrations.

Live database restore, schema drift inspection, container startup and rollout
remain untested. Source deployment layout is not yet known. No production
database was accessed or changed. Release remains blocked on unresolved
security findings and integration validation.
