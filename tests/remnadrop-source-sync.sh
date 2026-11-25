#!/usr/bin/env bash
set -Eeuo pipefail

source "$(dirname "$0")/../scripts/remnadrop-cli.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

git init --bare -b main "$fixture/remote.git" >/dev/null
git init -b main "$fixture/author" >/dev/null
git -C "$fixture/author" config user.name 'RemnaDrop test'
git -C "$fixture/author" config user.email 'test@example.invalid'
printf 'initial\n' > "$fixture/author/version.txt"
git -C "$fixture/author" add version.txt
git -C "$fixture/author" commit -m initial >/dev/null
git -C "$fixture/author" remote add origin "$fixture/remote.git"
git -C "$fixture/author" push -u origin main >/dev/null
git clone -b main "$fixture/remote.git" "$fixture/server" >/dev/null
REPO="$fixture/server"

printf 'fast-forward\n' > "$fixture/author/version.txt"
git -C "$fixture/author" commit -am fast-forward >/dev/null
git -C "$fixture/author" push origin main >/dev/null
update_source >/dev/null
test "$(git -C "$REPO" rev-parse HEAD)" = "$(git -C "$fixture/author" rev-parse HEAD)"
previous="$(git -C "$REPO" rev-parse HEAD)"

git -C "$fixture/author" switch --orphan clean-main >/dev/null
printf 'new root\n' > "$fixture/author/version.txt"
git -C "$fixture/author" add version.txt
git -C "$fixture/author" commit -m 'new root' >/dev/null
git -C "$fixture/author" push --force origin HEAD:main >/dev/null
update_source >/dev/null
test "$(git -C "$REPO" rev-parse HEAD)" = "$(git -C "$fixture/author" rev-parse HEAD)"
git -C "$REPO" for-each-ref --format='%(objectname)' refs/remnadrop/previous-main | grep -Fxq "$previous"

git -C "$REPO" config user.name 'Local admin'
git -C "$REPO" config user.email 'local@example.invalid'
git -C "$REPO" commit --allow-empty -m 'local work' >/dev/null
local_sha="$(git -C "$REPO" rev-parse HEAD)"
printf 'remote update\n' > "$fixture/author/version.txt"
git -C "$fixture/author" commit -am 'remote update' >/dev/null
git -C "$fixture/author" push origin HEAD:main >/dev/null
if ( update_source >/dev/null 2>&1 ); then
  printf 'Unexpectedly replaced a local commit\n' >&2
  exit 1
fi
test "$(git -C "$REPO" rev-parse HEAD)" = "$local_sha"
printf 'PASS: fast-forward, rewritten main, local commit protection\n'
