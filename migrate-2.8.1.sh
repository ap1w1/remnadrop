#!/usr/bin/env bash
# Run from the fork source directory. Existing installation is never reset.
set -Eeuo pipefail
INSTALL_DIR=${1:-/opt/remnawave}
IMAGE=${2:-panel-fork:2.8.1-test}
MODE=${3:-baseline}
[[ "$MODE" == baseline || "$MODE" == --update ]] || { echo 'Third argument must be --update or omitted'; exit 1; }
SOURCE=$(cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR=$(cd -- "$INSTALL_DIR" && pwd)
command -v docker >/dev/null
command -v python3 >/dev/null
exec 9>"$INSTALL_DIR/.panel-migration.lock"
flock -n 9 || { echo 'Another migration is running'; exit 1; }
TARGET_IMAGE_ID=$(docker image inspect -f '{{.Id}}' "$IMAGE")
[[ "$TARGET_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Target image ID is unavailable'; exit 1; }
[[ -z "${PANEL_TARGET_IMAGE_ID:-}" || "$TARGET_IMAGE_ID" == "$PANEL_TARGET_IMAGE_ID" ]] || {
  echo 'Target image changed after the updater verified it; refusing migration.'
  exit 1
}
ORIGINAL_CONTAINER_ID=$(docker inspect -f '{{.Id}}' remnawave)
VERSION=$(docker exec remnawave node -p 'require("/opt/app/package.json").version' 2>/dev/null || docker exec remnawave node -p 'require("/app/package.json").version')
[[ "$VERSION" == 2.8.1 ]] || { echo "Unsupported source: $VERSION"; exit 1; }
FILES=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' remnawave)
[[ -n "$FILES" ]] || { echo 'Compose configuration not found'; exit 1; }
BASE=$(python3 "$SOURCE/scripts/compose-files.py" "${FILES//,/:}" --managed "$INSTALL_DIR/compose.fork-auto.json")
OLD_IMAGE=$(docker inspect -f '{{.Image}}' remnawave)
SOURCE_IMAGE=$(docker inspect -f '{{.Config.Image}}' remnawave)
[[ "$SOURCE_IMAGE" == remnawave/backend:2.8.1 || "$MODE" == --update ]] || {
  echo 'This script only migrates the original remnawave/backend:2.8.1 image, not an already migrated fork.'
  exit 1
}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="$INSTALL_DIR/migration-backups/$STAMP"
umask 077
mkdir -p "$BACKUP"
dc() { COMPOSE_FILE="$BASE" docker compose --project-directory "$INSTALL_DIR" "$@"; }
dc config --format json > "$BACKUP/compose.resolved.json"
# Preserve env/config and old image reference without printing secrets.
[[ ! -f "$INSTALL_DIR/.env" ]] || cp "$INSTALL_DIR/.env" "$BACKUP/env"
printf '%s\n' "$BASE" > "$BACKUP/compose-files"
ROLLBACK_IMAGE="panel-fork:rollback-$STAMP"
if [[ -n "${PANEL_ROLLBACK_IMAGE:-}" ]]; then
  RECOVERED_CONTAINER=$(docker image inspect -f '{{ index .Config.Labels "recovery.container" }}' "$PANEL_ROLLBACK_IMAGE")
  [[ "$RECOVERED_CONTAINER" == "$(docker inspect -f '{{.Id}}' remnawave)" ]] || { echo 'Recovery image belongs to a different container'; exit 1; }
  docker image tag "$PANEL_ROLLBACK_IMAGE" "$ROLLBACK_IMAGE"
elif docker image inspect "$OLD_IMAGE" >/dev/null 2>&1; then
  docker image tag "$OLD_IMAGE" "$ROLLBACK_IMAGE"
else
  # Config.Image may already point to the new build; snapshot the actual container.
  echo 'Original image unavailable; snapshotting the current panel for rollback...'
  docker commit --pause=true remnawave "$ROLLBACK_IMAGE" >/dev/null
fi
docker image inspect "$ROLLBACK_IMAGE" >/dev/null
printf '%s\n' "$ROLLBACK_IMAGE" > "$BACKUP/old-image"
docker run --rm --network none --entrypoint node "$IMAGE" -e 'require("nestjs-zod").patchNestJsSwagger()'
docker cp "$SOURCE/backend/scripts/export-migration-history.sql" remnawave-db:/tmp/migration-history.sql
docker exec remnawave-db sh -ec 'psql -X -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/migration-history.sql' > "$BACKUP/history.json"
EXTRA_CHECK=()
[[ "$MODE" != --update ]] || EXTRA_CHECK=(/app/prisma/migrations)
docker run --rm --network none --entrypoint node \
  -v "$SOURCE/backend/scripts:/checks:ro" -v "$BACKUP:/backup:ro" "$IMAGE" \
  /checks/migration-preflight.mjs /backup/history.json 2.8.1 "${EXTRA_CHECK[@]}"
# Last-chance free space check AFTER image build/export and BEFORE service stop.
DB_BYTES="$(docker exec remnawave-db sh -ec 'psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_database_size(current_database())"')"
FREE_KIB="$(df -Pk "$INSTALL_DIR" | awk 'NR==2 {print $4}')"
[[ "$DB_BYTES" =~ ^[0-9]+$ && "$FREE_KIB" =~ ^[0-9]+$ ]] || { echo 'Cannot calculate DB/disk sizes; keeping panel online.'; exit 1; }
REQUIRED_KIB=$(((DB_BYTES * 2 + 1073741824 + 1023) / 1024))
if (( FREE_KIB < REQUIRED_KIB )); then
  echo "Need ${REQUIRED_KIB} KiB free for safe test restore; only ${FREE_KIB} KiB available. Panel remains online."
  exit 1
fi
echo 'Stopping panel writes and taking a database backup...'
dc stop remnawave
SCHEMA_MAY_HAVE_CHANGED=0
recover() {
  echo "Migration failed. Database/config backup: $BACKUP"
  if [[ "$SCHEMA_MAY_HAVE_CHANGED" == 0 ]]; then
    echo 'Migrations not started: attempting to restart the original stopped container.'
    docker start remnawave || echo 'WARNING: original panel did not start'
  else
    echo 'Migrations may have started: do NOT restart old panel without reviewing DB rollback.'
  fi
}
trap recover ERR
docker exec remnawave-db sh -ec 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$BACKUP/database.dump"
test -s "$BACKUP/database.dump"
docker exec -i remnawave-db pg_restore --list < "$BACKUP/database.dump" > "$BACKUP/database.contents"
# Verify the backup by actually restoring it, without touching the source database.
CHECK_DB="migration_check_${STAMP,,}"
docker exec remnawave-db sh -ec 'createdb -U "$POSTGRES_USER" "$1"' sh "$CHECK_DB"
docker exec -i remnawave-db sh -ec 'pg_restore --exit-on-error --no-owner -U "$POSTGRES_USER" -d "$1"' sh "$CHECK_DB" < "$BACKUP/database.dump"
docker exec remnawave-db sh -ec 'dropdb -U "$POSTGRES_USER" "$1"' sh "$CHECK_DB"
cat > "$INSTALL_DIR/panel-start.sh" <<'RUNNER'
#!/bin/bash
set -u
pids=()
cleanup() { trap - TERM INT; kill -TERM "${pids[@]}" 2>/dev/null || true; wait || true; }
trap 'cleanup; exit 0' TERM INT
INSTANCE_TYPE=api node dist/src/main.js & pids+=("$!")
INSTANCE_TYPE=processor node dist/src/bin/processors/processors.js & pids+=("$!")
INSTANCE_TYPE=scheduler node dist/src/bin/scheduler/scheduler.js & pids+=("$!")
wait -n "${pids[@]}"
cleanup
exit 1
RUNNER
python3 - "$INSTALL_DIR" "$IMAGE" <<'PY'
import json, sys, pathlib, secrets
root, image = sys.argv[1:]
secret_path=pathlib.Path(root, '.node-metrics-secret')
if not secret_path.exists():
    secret_path.write_text(secrets.token_urlsafe(48))
service = dict(image=image, pull_policy='never', init=True, working_dir='/app',
 entrypoint=['/bin/bash', '/app/panel-start.sh'], command=[],
 environment={'NODE_ENV':'production', 'INSTANCE_ID':'0', '__RW_METADATA_VERSION':'2.8.1-fork-test', 'NODE_METRICS_SECRET':secret_path.read_text().strip()},
 volumes=[f'{root}/panel-start.sh:/app/panel-start.sh:ro'],
 healthcheck={'test':['CMD','node','-e',"fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
 'interval':'30s','timeout':'5s','retries':3,'start_period':'60s'})
pathlib.Path(root, 'compose.fork-auto.json').write_text(json.dumps({'services':{'remnawave':service}}, indent=2))
PY
NEW=$(python3 "$SOURCE/scripts/compose-files.py" "$BASE" --append "$INSTALL_DIR/compose.fork-auto.json")
newdc() { COMPOSE_FILE="$NEW" docker compose --project-directory "$INSTALL_DIR" "$@"; }
newdc config --quiet
[[ "$(docker image inspect -f '{{.Id}}' "$IMAGE")" == "$TARGET_IMAGE_ID" ]] || {
  echo 'Target image changed before migration; refusing to deploy it.'
  false
}
SCHEMA_MAY_HAVE_CHANGED=1
newdc run --rm --no-deps --entrypoint npm remnawave run migrate:deploy
[[ "$(docker image inspect -f '{{.Id}}' "$IMAGE")" == "$TARGET_IMAGE_ID" ]] || {
  echo 'Target image changed during migration; refusing to start an unverified image.'
  false
}
# A rebuilt tag can retain the same Compose configuration. Always replace the
# panel container; a stop/start can leave its old root filesystem running.
newdc up -d --no-deps --force-recreate --no-build --pull never remnawave
DEPLOYED_CONTAINER_ID=$(docker inspect -f '{{.Id}}' remnawave)
[[ "$DEPLOYED_CONTAINER_ID" != "$ORIGINAL_CONTAINER_ID" ]] || {
  echo 'Panel container was not recreated; refusing to report a successful update.'
  false
}
for attempt in $(seq 1 60); do
  CURRENT_IMAGE_ID=$(docker inspect -f '{{.Image}}' remnawave)
  [[ "$CURRENT_IMAGE_ID" == "$TARGET_IMAGE_ID" ]] || {
    echo "Wrong running image: expected $TARGET_IMAGE_ID, got $CURRENT_IMAGE_ID"
    false
  }
  [[ "$(docker inspect -f '{{.Id}}' remnawave)" == "$DEPLOYED_CONTAINER_ID" ]] || {
    echo 'Panel container changed while checking the deployment.'
    false
  }
  READY_STATE=$(docker inspect -f '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' remnawave)
  case "$READY_STATE" in
    'true healthy'|'true starting') ;;
    *) echo "Panel is not ready: $READY_STATE"; false ;;
  esac
  if [[ "$READY_STATE" == 'true healthy' ]] && docker exec remnawave node -e "fetch('http://127.0.0.1:3000/',{headers:{'X-Forwarded-For':'127.0.0.1','X-Forwarded-Proto':'https'}}).then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"; then
    COMPOSE_FILES_TEMP=$(mktemp "$INSTALL_DIR/.panel-compose-files.XXXXXXXX")
    printf '%s\n' "$NEW" > "$COMPOSE_FILES_TEMP"
    mv -f -- "$COMPOSE_FILES_TEMP" "$INSTALL_DIR/.panel-compose-files"
    echo "Image ID, health and HTTP checks passed. Backup: $BACKUP"
    printf 'Rollback: sudo bash %q/rollback.sh %q\n' "$SOURCE" "$BACKUP"
    printf 'For future operations: export COMPOSE_FILE="$(cat %q/.panel-compose-files)"\n' "$INSTALL_DIR"
    exit 0
  fi
  sleep 2
done
echo 'Panel health/HTTP startup check failed; inspect docker logs remnawave.'
false
