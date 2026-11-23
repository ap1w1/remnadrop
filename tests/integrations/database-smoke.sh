#!/usr/bin/env bash
# Exercise the built image against disposable services only; no host ports/data.
set -Eeuo pipefail

IMAGE=${1:-remnadrop-integrations-qa}
TESTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for executable in docker python3 timeout; do command -v "$executable" >/dev/null; done
docker image inspect "$IMAGE" >/dev/null

RUN_ID="remnadrop-smoke-$(date -u +%Y%m%d%H%M%S)-$$-$RANDOM"
NETWORK="$RUN_ID-net"
DATABASE="$RUN_ID-db"
REDIS="$RUN_ID-redis"
API="$RUN_ID-api"
BASELINE="$RUN_ID-baseline"
LEGACY="$RUN_ID-legacy"
UPGRADE="$RUN_ID-upgrade"
REPEAT="$RUN_ID-repeat"
ENV_FILE=$(mktemp)
chmod 600 "$ENV_FILE"

cleanup() {
  local status=$?
  trap - EXIT
  if (( status != 0 )); then
    printf '\nApplication/database smoke failed; ephemeral service logs follow.\n' >&2
    if docker inspect "$API" >/dev/null 2>&1; then docker logs --tail 100 "$API" >&2 || true; fi
    if docker inspect "$DATABASE" >/dev/null 2>&1; then docker logs --tail 50 "$DATABASE" >&2 || true; fi
  fi
  docker rm -f -v "$API" "$BASELINE" "$LEGACY" "$UPGRADE" "$REPEAT" "$REDIS" "$DATABASE" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  rm -f -- "$ENV_FILE"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

python3 - "$ENV_FILE" "$DATABASE" "$REDIS" <<'PY'
import pathlib
import secrets
import sys

path, database, redis = sys.argv[1:]
password = secrets.token_hex(24)
values = {
    'REMNADROP_SMOKE_TEST': '1',
    'POSTGRES_USER': 'smoke',
    'POSTGRES_PASSWORD': password,
    'POSTGRES_DB': 'remnadrop_smoke',
    'DATABASE_URL': f'postgresql://smoke:{password}@{database}:5432/remnadrop_smoke',
    'REDIS_HOST': redis,
    'REDIS_PORT': '6379',
    'REDIS_SOCKET': '',
    'REDIS_DB': '1',
    'APP_SECRET': secrets.token_hex(48),
    'CLOUDFLARE_DNS_INCOMING_SECRET': secrets.token_hex(48),
    'APP_PORT': '3000',
    'METRICS_PORT': '3001',
    'METRICS_USER': 'smoke',
    'METRICS_PASS': secrets.token_hex(24),
    'FRONT_END_DOMAIN': 'http://localhost:3000',
    'SUB_PUBLIC_DOMAIN': 'localhost:3000/api/sub',
    'NODE_ENV': 'production',
    'INSTANCE_TYPE': 'api',
    'INSTANCE_ID': '0',
    'IS_TELEGRAM_NOTIFICATIONS_ENABLED': 'false',
    'WEBHOOK_ENABLED': 'false',
    'IS_DOCS_ENABLED': 'false',
}
pathlib.Path(path).write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
PY

# Pulling images is the only network access outside the disposable Docker network.
docker pull postgres:18.4 >/dev/null
docker pull valkey/valkey:8.1-alpine >/dev/null
docker network create --internal "$NETWORK" >/dev/null
docker run -d --name "$DATABASE" --network "$NETWORK" --env-file "$ENV_FILE" \
  --mount type=tmpfs,destination=/var/lib/postgresql,tmpfs-size=536870912 \
  postgres:18.4 >/dev/null
docker run -d --name "$REDIS" --network "$NETWORK" \
  --mount type=tmpfs,destination=/data,tmpfs-size=134217728 \
  valkey/valkey:8.1-alpine valkey-server --save '' --appendonly yes --appendfsync always >/dev/null

for attempt in $(seq 1 40); do
  if docker exec "$DATABASE" pg_isready -U smoke -d remnadrop_smoke -t 2 >/dev/null 2>&1 \
    && timeout 5s docker exec "$REDIS" valkey-cli ping | grep -qx PONG; then
    break
  fi
  if (( attempt == 40 )); then
    printf 'Disposable PostgreSQL/Valkey did not become ready.\n' >&2
    exit 1
  fi
  sleep 1
done

run_image() {
  local name=$1
  shift
  timeout --signal=TERM --kill-after=10s 240s docker run --rm --name "$name" \
    --network "$NETWORK" --env-file "$ENV_FILE" \
    --mount "type=bind,source=$TESTS_DIR,target=/checks,readonly" \
    --entrypoint sh "$IMAGE" -ec "$1"
}

printf '\nApplying 128 baseline migrations and inserting an existing user...\n'
run_image "$BASELINE" '
  node /checks/application-smoke.cjs stage-baseline
  npm run migrate:deploy
  npm run migrate:seed
  node /checks/application-smoke.cjs prepare-baseline
'

printf '\nApplying previous release 129 and seeding existing integrations...\n'
run_image "$LEGACY" '
  node /checks/application-smoke.cjs stage-legacy
  npm run migrate:deploy
  node /checks/application-smoke.cjs prepare-legacy
'

printf '\nUpgrading existing integrations and automation workflows...\n'
run_image "$UPGRADE" '
  npm run migrate:deploy
  node /checks/application-smoke.cjs verify-upgrade
'

printf '\nRepeating deployment to verify migration idempotence...\n'
run_image "$REPEAT" '
  npm run migrate:deploy
  node /checks/application-smoke.cjs verify-upgrade
  node /checks/panel-events-smoke.cjs
  node /checks/panel-push-smoke.cjs
'

printf '\nStarting the real API and checking authenticated endpoints...\n'
docker run -d --name "$API" --network "$NETWORK" --env-file "$ENV_FILE" \
  --mount "type=bind,source=$TESTS_DIR,target=/checks,readonly" \
  --entrypoint node "$IMAGE" dist/src/main.js >/dev/null
timeout --signal=TERM --kill-after=10s 240s docker exec "$API" \
  node /checks/application-smoke.cjs api
printf '\nPostgreSQL baseline -> previous release -> current release and real application smoke passed.\n'
