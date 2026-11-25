#!/usr/bin/env bash
# Restore into a NEW database, preserving the current database for investigation.
set -Eeuo pipefail
BACKUP=$(cd -- "${1:?Usage: bash rollback.sh BACKUP_DIRECTORY}" && pwd)
test -s "$BACKUP/database.dump"
test -s "$BACKUP/compose.resolved.json"
test -s "$BACKUP/old-image"
umask 077
exec 9>"$BACKUP/rollback.lock"
flock -n 9
DATABASE="rollback_$(date -u +%Y%m%d%H%M%S)"
docker image inspect "$(cat "$BACKUP/old-image")" >/dev/null
docker exec remnawave-db sh -ec 'createdb -U "$POSTGRES_USER" "$1"' sh "$DATABASE"
docker exec -i remnawave-db sh -ec 'pg_restore --exit-on-error --no-owner -U "$POSTGRES_USER" -d "$1"' sh "$DATABASE" < "$BACKUP/database.dump"
python3 - "$BACKUP" "$DATABASE" <<'PY'
import json, pathlib, sys, urllib.parse
root=pathlib.Path(sys.argv[1])
config=json.loads((root/'compose.resolved.json').read_text())
service=config['services']['remnawave']
service['image']=(root/'old-image').read_text().strip()
service['pull_policy']='never'
for key in ('DATABASE_URL','DIRECT_URL'):
    value=service.get('environment',{}).get(key)
    if value:
        url=urllib.parse.urlsplit(value)
        service['environment'][key]=urllib.parse.urlunsplit(url._replace(path='/'+sys.argv[2]))
if not service.get('environment',{}).get('DATABASE_URL'):
    raise SystemExit('DATABASE_URL missing from saved configuration')
(root/'compose.rollback.json').write_text(json.dumps(config,indent=2))
PY
docker compose -f "$BACKUP/compose.rollback.json" config --quiet
docker stop remnawave
docker compose -f "$BACKUP/compose.rollback.json" up -d --no-deps remnawave
echo "Restored into separate database: $DATABASE. Previous database is preserved."
echo "Compose configuration: $BACKUP/compose.rollback.json"
docker logs --tail=30 remnawave
