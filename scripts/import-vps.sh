#!/usr/bin/env bash
set -Eeuo pipefail
SOURCE="$1"
TARGET="/opt/remnadrop-git"
REPO="https://github.com/ap1w1/remnadrop.git"
fail() { echo "ERROR: $*" >&2; exit 1; }
command -v git >/dev/null || fail "Install git"
command -v rsync >/dev/null || fail "Install rsync"
command -v python3 >/dev/null || fail "Install python3"
TEMP=""
cleanup() { if [ -n "$TEMP" ]; then rm -rf "$TEMP"; fi; }
trap cleanup EXIT

if [ -f "$SOURCE" ]; then
  case "$SOURCE" in
    *.zip)
      TEMP="$(mktemp -d)"
      python3 - "$SOURCE" "$TEMP" <<'PY'
from zipfile import ZipFile
from pathlib import Path
import sys
with ZipFile(sys.argv[1]) as z:
    for f in z.infolist():
        n=Path(f.filename)
        if n.is_absolute() or '..' in n.parts: raise SystemExit("Invalid ZIP filename")
    z.extractall(sys.argv[2])
PY
      SOURCE="$TEMP/remnadrop-updated"
      ;;
    *) fail "Supply an extracted source directory or ZIP file";;
  esac
fi

[ -d "$SOURCE/backend" ] && [ -d "$SOURCE/frontend" ] && [ -f "$SOURCE/Dockerfile.dev" ] || fail "Missing backend/frontend/Dockerfile.dev in $SOURCE"

if [ ! -d "$TARGET/.git" ]; then
  [ ! -e "$TARGET" ] || fail "$TARGET exists and is not a Git clone"
  git clone "$REPO" "$TARGET"
fi
git -C "$TARGET" remote get-url origin | grep -q 'ap1w1/remnadrop' || fail "Unexpected Git remote"
[ -z "$(git -C "$TARGET" status --porcelain)" ] || fail "Uncommitted changes in repository"
git -C "$TARGET" checkout main
git -C "$TARGET" pull --ff-only origin main

rsync -a --delete \
  --exclude='/.git/' --exclude='/.gitignore' --exclude='/.github/' --exclude='/scripts/' \
  --include='**/.env.sample' --include='**/.env.example' \
  --exclude='**/.env' --exclude='**/.env.*' \
  --exclude='**/node_modules/' --exclude='**/dist/' --exclude='**/build/' \
  --exclude='**/.cache/' --exclude='**/secrets/' --exclude='**/credentials/' \
  --exclude='**/*.pem' --exclude='**/*.key' --exclude='**/*.p12' --exclude='**/*.pfx' \
  --exclude='**/*.dump' --exclude='**/*.backup' --exclude='**/*.bak' \
  --exclude='**/*.sqlite*' --exclude='**/*.log' --exclude='**/*.zip' \
  --exclude='**/*.tar.gz' --exclude='**/history.json' \
  "$SOURCE/" "$TARGET/"

git -C "$TARGET" add -A
# Permit only the intentionally public .env.sample/.env.example templates.
# Reject actual env files and secrets even when a .gitignore rule is changed.
python3 - "$TARGET" <<'PY'
import re, subprocess, sys
repo = sys.argv[1]
paths = subprocess.check_output(
    ["git", "-C", repo, "diff", "--cached", "--name-only", "-z"]
).split(b"\0")
for raw in paths:
    if not raw:
        continue
    p = raw.decode("utf-8")
    parts = p.split("/")
    name = parts[-1].lower()
    if name in (".env.sample", ".env.example"):
        continue
    suspicious = (
        name == ".env"
        or name.startswith(".env.")
        or name in ("id_rsa", "id_ed25519")
        or "secrets" in parts
        or "credentials" in parts
        or bool(re.search(r"\.(pem|key|p12|pfx|dump|backup|sqlite3?)$", name))
    )
    if suspicious:
        raise SystemExit(f"Sensitive filename staged: {p}. Nothing pushed.")
PY
git -C "$TARGET" diff --cached --stat | tail -25
if git -C "$TARGET" diff --cached --quiet; then echo "No new changes"; exit 0; fi

# Staged text content scan for private-key PEM blocks.
python3 - "$TARGET" <<'PY'
import subprocess,sys
root=sys.argv[1]
paths=subprocess.check_output(["git","-C",root,"diff","--cached","--name-only","-z"]).split(b"\0")
for p in paths:
    if not p: continue
    try:
        data=open(root+"/"+p.decode(),"rb").read()
    except (IsADirectoryError,FileNotFoundError): continue
    for marker in [b"-----BEGIN PRIVATE KEY-----",b"-----BEGIN RSA PRIVATE KEY-----",b"-----BEGIN OPENSSH PRIVATE KEY-----"]:
        if marker in data:
            raise SystemExit("Private key detected in "+p.decode()+". Nothing pushed.")
PY

git -C "$TARGET" -c user.name="RemnaDrop Import" -c user.email="remnadrop-import@users.noreply.github.com" commit -m "feat: import RemnaDrop 2.8.1 fork sources"
git -C "$TARGET" push origin main
echo "Uploaded: https://github.com/ap1w1/remnadrop"
echo "Commit: $(git -C "$TARGET" rev-parse HEAD)"
