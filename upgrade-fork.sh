#!/usr/bin/env bash
# Safe, interactive-free updater for RemnaDrop 2.8.1 fork.
# Run on the panel VPS as root, from an extracted, trusted source archive.
set -Eeuo pipefail

SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/remnawave}"
IMAGE="${IMAGE:-panel-fork:2.8.1-ops-$(date -u +%Y%m%d%H%M%S)}"
DRY_RUN="${DRY_RUN:-0}"

say() { printf '\n[RemnaDrop] %s\n' "$*"; }
fail() { printf '\n[RemnaDrop] ERROR: %s\n' "$*" >&2; exit 1; }

[[ "${EUID}" -eq 0 ]] || fail 'Run as root (sudo bash upgrade-fork.sh).'
for executable in docker python3 flock df awk; do
  command -v "$executable" >/dev/null 2>&1 || fail "Missing $executable"
done
[[ -d "$INSTALL_DIR" ]] || fail "Installation directory does not exist: $INSTALL_DIR"
[[ -f "$SOURCE/Dockerfile.dev" && -f "$SOURCE/migrate-2.8.1.sh" && -f "$SOURCE/recover-export.py" && -f "$SOURCE/scripts/compose-files.py" ]] || fail 'Incomplete source archive'

docker info >/dev/null 2>&1 || fail 'Docker daemon unavailable'
docker inspect remnawave >/dev/null 2>&1 || fail 'Existing remnawave container missing'
docker inspect remnawave-db >/dev/null 2>&1 || fail 'Postgres container remnawave-db missing'
docker inspect remnawave-redis >/dev/null 2>&1 || fail 'Redis container remnawave-redis missing'
[[ "$(docker inspect -f '{{.State.Running}}' remnawave-db)" == true ]] || fail 'Database container not running'
[[ "$(docker inspect -f '{{.State.Running}}' remnawave)" == true ]] || fail 'Panel container not running'

umask 077
mkdir -p "$INSTALL_DIR/update-backups"
exec 8>"$INSTALL_DIR/.ops-upgrade.lock"
flock -n 8 || fail 'Another upgrade is running'
CONTAINER_ID="$(docker inspect -f '{{.Id}}' remnawave)"
OLD_IMAGE="$(docker inspect -f '{{.Config.Image}}' remnawave)"
say "Panel: $CONTAINER_ID; current image: $OLD_IMAGE"
say "Target image: $IMAGE"

# Prevent disk exhaustion while exporting the old image and testing DB restore.
# This check does not free/remove any user data.
FREE_KIB="$(df -Pk "$INSTALL_DIR" | awk 'NR==2 {print $4}')"
MIN_FREE_GIB="${MIN_FREE_GIB:-4}"
[[ "$MIN_FREE_GIB" =~ ^[0-9]+$ ]] || fail 'MIN_FREE_GIB must be a whole number'
if [[ -z "$FREE_KIB" ]] || (( FREE_KIB < MIN_FREE_GIB*1024*1024 )); then
  fail "Not enough free disk space: ${FREE_KIB:-unknown} KiB; minimum ${MIN_FREE_GIB} GiB. Move old backups elsewhere before upgrading."
fi
say "Free disk before build: ${FREE_KIB} KiB"

if [[ "$DRY_RUN" == 1 ]]; then
  say 'Preflight successful; DRY_RUN=1, no files changed.'
  exit 0
fi

# Each run has its own backups; never reuse rollback images belonging to old containers.
BACKUP_DIR="$(mktemp -d "$INSTALL_DIR/update-backups/ops-XXXXXXXX")"
printf '%s\n' "$BACKUP_DIR" > "$INSTALL_DIR/.last-ops-update-backup"
say "Backup directory: $BACKUP_DIR"

say 'Building fresh image (running panel is not touched)...'
docker build --progress=plain -f "$SOURCE/Dockerfile.dev" -t "$IMAGE" "$SOURCE" \
  2>&1 | tee "$BACKUP_DIR/docker-build.log"
# A tag can be reused while the old container still refers to a different image.
# Compare IDs returned by this daemon, not BuildKit's config/manifest digests.
TARGET_IMAGE_ID="$(docker image inspect -f '{{.Id}}' "$IMAGE")"
[[ "$TARGET_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'Cannot identify the built image'
printf '%s\n' "$TARGET_IMAGE_ID" > "$BACKUP_DIR/target-image-id"
say "Built image ID: $TARGET_IMAGE_ID"

# This explicit marker prevents retagging a stale build by accident.
say 'Verifying new frontend and migration files...'
docker run --rm --network none --entrypoint sh "$IMAGE" -ec '
  test -f /app/frontend/index.html
  test -f /app/prisma/migrations/20261120233000_monitoring_retention/migration.sql
  grep -RqlF "t.me/dpi_checker_robot?start=p453722" /app/frontend
  grep -RqlF "Документация API" /app/frontend
  grep -RqlF "Схема связей" /app/frontend
  grep -RqlF "Бэкапы" /app/frontend
  test -f /app/prisma/migrations/20261120235500_backup_targets/migration.sql
'

[[ "$(docker inspect -f '{{.Id}}' remnawave)" == "$CONTAINER_ID" ]] || fail 'Panel container changed during build; refusing to proceed'

say 'Saving a separate PostgreSQL dump before switching...'
DB_BACKUP="$BACKUP_DIR/database-pre-upgrade.dump"
docker exec remnawave-db sh -ec 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$DB_BACKUP"
test -s "$DB_BACKUP" || fail 'Database dump is empty'
docker exec -i remnawave-db pg_restore --list < "$DB_BACKUP" > "$BACKUP_DIR/database-pre-upgrade.list" || fail 'Cannot read database dump'
say 'Database dump verified structurally. The migration script also performs test restoration.'

# The rollback export uses disk twice: once for rootfs.tar and once for the
# docker-imported recovery image. Check AFTER Docker build and the pre-upgrade
# DB dump, but BEFORE creating either artifact or stopping the panel.
say 'Checking free space for export, recovery image and PostgreSQL restore...'
ROOTFS_BYTES="$(docker inspect --size -f '{{.SizeRootFs}}' remnawave)"
DB_BYTES="$(docker exec remnawave-db sh -ec 'psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_database_size(current_database())"')"
FREE_KIB="$(df -Pk "$INSTALL_DIR" | awk 'NR==2 {print $4}')"
[[ "$ROOTFS_BYTES" =~ ^[0-9]+$ && "$DB_BYTES" =~ ^[0-9]+$ && "$FREE_KIB" =~ ^[0-9]+$ ]] || fail 'Unable to estimate free space; refusing rollback export.'
# 2x container size (tar + imported image), 2x DB size for test restore,
# plus 1.5 GiB of WAL, Docker and OS headroom; conservative by design.
REQUIRED_KIB=$(((2 * ROOTFS_BYTES + 2 * DB_BYTES + 1610612736 + 1023) / 1024))
if (( FREE_KIB < REQUIRED_KIB )); then
  fail "Not enough free space after build: ${FREE_KIB} KiB; need >= ${REQUIRED_KIB} KiB for safe rollback export and PostgreSQL restore. The current panel remains online. Remove unused images or expand disk."
fi
say "Disk reserve OK: ${FREE_KIB} KiB free; estimated requirement ${REQUIRED_KIB} KiB"
say 'Exporting current container for reliable rollback...'
docker inspect remnawave > "$BACKUP_DIR/container.json"
docker export remnawave -o "$BACKUP_DIR/rootfs.tar"
[[ -s "$BACKUP_DIR/rootfs.tar" ]] || fail 'Failed to export current container'
python3 "$SOURCE/recover-export.py" "$BACKUP_DIR"
[[ -s "$BACKUP_DIR/rollback-image" ]] || fail 'Rollback image not created'

[[ "$(docker inspect -f '{{.Id}}' remnawave)" == "$CONTAINER_ID" ]] || fail 'Panel container changed after export'
[[ "$(docker image inspect -f '{{.Id}}' "$IMAGE")" == "$TARGET_IMAGE_ID" ]] || fail 'Target image tag changed after build; refusing to switch'

say 'Switching to the new image, with database backup, test restore, and migrations...'
set +e
PANEL_ROLLBACK_IMAGE="$(cat "$BACKUP_DIR/rollback-image")" \
  PANEL_TARGET_IMAGE_ID="$TARGET_IMAGE_ID" \
  bash "$SOURCE/migrate-2.8.1.sh" "$INSTALL_DIR" "$IMAGE" --update \
  2>&1 | tee "$BACKUP_DIR/migration.log"
RESULT=${PIPESTATUS[0]}
set -e
if [[ "$RESULT" -ne 0 ]]; then
  fail "Upgrade failed. DO NOT launch old image against a partially migrated DB. Backups: $BACKUP_DIR ; inspect $BACKUP_DIR/migration.log"
fi

say 'Checking running container...'
CURRENT_CONTAINER_ID="$(docker inspect -f '{{.Id}}' remnawave)"
[[ "$CURRENT_CONTAINER_ID" != "$CONTAINER_ID" ]] || fail 'Panel container was not recreated'
CURRENT_IMAGE="$(docker inspect -f '{{.Config.Image}}' remnawave)"
[[ "$CURRENT_IMAGE" == "$IMAGE" ]] || fail "Unexpected running image $CURRENT_IMAGE"
CURRENT_IMAGE_ID="$(docker inspect -f '{{.Image}}' remnawave)"
[[ "$CURRENT_IMAGE_ID" == "$TARGET_IMAGE_ID" ]] || fail "Wrong running image ID: $CURRENT_IMAGE_ID; expected $TARGET_IMAGE_ID"
for attempt in $(seq 1 15); do
  [[ "$(docker inspect -f '{{.State.Running}}' remnawave)" == true ]] || fail 'Panel container is not running; inspect logs and backups'
  HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' remnawave)"
  [[ "$HEALTH" == healthy ]] && break
  sleep 2
done
[[ "${HEALTH:-}" == healthy ]] || fail 'Container did not become healthy; inspect logs and backups'
[[ "$(docker inspect -f '{{.Image}}' remnawave)" == "$TARGET_IMAGE_ID" ]] || fail 'Panel image changed during verification'

say "SUCCESS: $IMAGE ($TARGET_IMAGE_ID) is running and healthy"
say "Backups: $BACKUP_DIR"
if command -v systemctl >/dev/null 2>&1 && [[ -f "$SOURCE/backup-agent/install-agent.sh" ]]; then
  say 'Installing host-side backup worker and independent schedules...'
  if bash "$SOURCE/backup-agent/install-agent.sh"; then
    say 'Backup agent timer installed. Configure rclone remotes separately for cloud destinations.'
  else
    say 'WARNING: panel upgrade succeeded, but backup-agent installation failed.'
    say 'Fix and rerun: sudo bash '"$SOURCE/backup-agent/install-agent.sh"
  fi
else
  say 'WARNING: systemd not found; backup-agent must be installed and scheduled manually.'
fi
say 'Check the browser with Ctrl+Shift+R. Node TLS errors require separate diagnostics.'
