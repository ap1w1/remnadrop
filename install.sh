#!/usr/bin/env bash
set -Eeuo pipefail
SOURCE=$(cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR=${1:-/opt/remnawave}
MODE=${2:-baseline}
[[ "$MODE" == baseline || "$MODE" == --update ]] || { echo 'Usage: bash install.sh /opt/remnawave [--update]'; exit 1; }
command -v docker >/dev/null
command -v python3 >/dev/null
command -v flock >/dev/null
docker compose version >/dev/null
docker info >/dev/null
cd "$SOURCE"
docker build --progress=plain -f Dockerfile.dev -t remnadrop:2.8.1-test .
bash "$SOURCE/migrate-2.8.1.sh" "$INSTALL_DIR" remnadrop:2.8.1-test "$MODE"
