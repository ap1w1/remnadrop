#!/usr/bin/env bash
# RemnaDrop server CLI: pull a pinned GitHub commit and use backup-aware updater.
set -Eeuo pipefail

REPO=/opt/remnadrop-git
INSTALL_DIR=/opt/remnawave
RELEASES=/opt/panel-build/remnadrop-releases
ACTION="$(printf '%s' "$*" | awk '{print $1}')"
ACTION="$(printf '%s' "$ACTION" | tr '[:upper:]' '[:lower:]')"
say() { printf '[RemnaDrop] %s\n' "$*"; }
fail() { printf '[RemnaDrop] ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || fail "Missing executable: $1"; }
check_repo() {
  [ -d "$REPO/.git" ] || fail "Repository missing: $REPO"
  URL="$(git -C "$REPO" remote get-url origin)"
  case "$URL" in
    https://github.com/ap1w1/remnadrop|https://github.com/ap1w1/remnadrop.git|git@github.com:ap1w1/remnadrop.git|ssh://git@github.com/ap1w1/remnadrop.git) ;;
    *) fail "Unexpected Git remote: $URL";;
  esac
}
check_clean() {
  [ -z "$(git -C "$REPO" status --porcelain)" ] || fail "Uncommitted/untracked files in $REPO; refusing automatic update"
  [ "$(git -C "$REPO" branch --show-current)" = main ] || fail "Expected branch main"
}
update_source() {
  local old_sha target_sha remote_heads backup_ref
  old_sha="$(git -C "$REPO" rev-parse HEAD)"
  say 'Fetching GitHub repository...'
  git -C "$REPO" fetch --no-tags origin main
  target_sha="$(git -C "$REPO" rev-parse --verify 'refs/remotes/origin/main^{commit}')"
  [ -n "$target_sha" ] || fail 'Could not resolve origin/main after fetch'
  if git -C "$REPO" merge-base --is-ancestor "$old_sha" "$target_sha"; then
    git -C "$REPO" merge --ff-only "$target_sha"
  else
    # A force-pushed main can have an unrelated root. Never discard local-only commits.
    remote_heads="$(git -C "$REPO" reflog show --format=%H refs/remotes/origin/main)" ||
      fail 'Cannot verify previous origin/main; see INSTALL.md for manual recovery'
    grep -Fxq -- "$old_sha" <<< "$remote_heads" ||
      fail 'Local main was not a previous origin/main; refusing to replace local commits'
    backup_ref="refs/remnadrop/previous-main/$(date -u +%Y%m%dT%H%M%SZ)-${old_sha:0:12}"
    git -C "$REPO" update-ref "$backup_ref" "$old_sha"
    say "Git history changed; saved previous main as $backup_ref"
    git -C "$REPO" reset --hard "$target_sha"
  fi
  check_clean
}
snapshot() {
  SHA="$1"
  SHORTSHA="$(printf '%s' "$SHA" | cut -c1-12)"
  RELEASE="$RELEASES/remnadrop-$SHORTSHA"
  if [ -d "$RELEASE" ]; then
    [ -f "$RELEASE/.remnadrop-source-sha" ] && [ "$(cat "$RELEASE/.remnadrop-source-sha")" = "$SHA" ] ||
      fail "Release directory exists but SHA does not match: $RELEASE"
  else
    mkdir -p "$RELEASES"
    TEMP="$(mktemp -d "$RELEASES/.stage-XXXXXXXX")"
    if ! git -C "$REPO" archive "$SHA" | tar -xf - -C "$TEMP"; then
      rm -rf "$TEMP"
      fail "Could not export Git snapshot"
    fi
    for file in Dockerfile.dev upgrade-fork.sh migrate-2.8.1.sh recover-export.py scripts/compose-files.py; do
      [ -f "$TEMP/$file" ] || fail "Missing $file in Git snapshot"
    done
    printf '%s\n' "$SHA" > "$TEMP/.remnadrop-source-sha"
    mv -T "$TEMP" "$RELEASE"
  fi
}

if [[ ${BASH_SOURCE[0]} != "$0" ]]; then return 0; fi

case "$ACTION" in
  help|-h|--help|"")
    cat <<'HELP'
RemnaDrop CLI
  sudo remnadrop status    Show Git version and running container
  sudo remnadrop check     Preflight, no upgrade or restart
  sudo remnadrop update    Pull main and run backed-up build and migration

First-time setup (on VPS):
  sudo git clone https://github.com/ap1w1/remnadrop.git /opt/remnadrop-git
  cd /opt/remnadrop-git
  sudo install -m 755 scripts/remnadrop-cli.sh /usr/local/bin/remnadrop
  sudo remnadrop check
  sudo remnadrop update

WARNING: update performs schema migrations and restarts production services.
Test on a staging copy first. Database rollback is not automatic.
HELP
    ;;
  status)
    need git; need docker; check_repo
    say "Git HEAD: $(git -C "$REPO" rev-parse --short=12 HEAD)"
    docker inspect remnawave --format 'Image: {{.Config.Image}} | ID: {{.Image}} | Running: {{.State.Running}} | Health: {{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' ||
      say 'Panel container not found'
    [ ! -f "$INSTALL_DIR/.last-ops-update-backup" ] ||
      say "Last backup: $(cat "$INSTALL_DIR/.last-ops-update-backup")"
    ;;
  check|update)
    [ "$(id -u)" -eq 0 ] || fail "Run as root: sudo remnadrop $ACTION"
    for x in git docker tar flock python3 awk cut grep date; do need "$x"; done
    check_repo
    mkdir -p "$INSTALL_DIR"
    exec 7>"$INSTALL_DIR/.remnadrop-git-update.lock"
    flock -n 7 || fail 'Another Git updater is running'
    check_clean

    if [ "$ACTION" = update ]; then
      update_source
    fi

    SHA="$(git -C "$REPO" rev-parse HEAD)"
    snapshot "$SHA"
    say "Revision: $SHA"
    say "Snapshot: $RELEASE"

    if [ "$ACTION" = check ]; then
      DRY_RUN=1 INSTALL_DIR="$INSTALL_DIR" bash "$RELEASE/upgrade-fork.sh"
      say 'Preflight passed; source files unchanged and panel not restarted'
      exit 0
    fi

    IMAGE="panel-fork:2.8.1-git-$SHORTSHA"
    say "Applying update using $IMAGE"
    INSTALL_DIR="$INSTALL_DIR" IMAGE="$IMAGE" bash "$RELEASE/upgrade-fork.sh"
    # Do not report success for an old healthy container with the same tag.
    EXPECTED_IMAGE_ID="$(docker image inspect -f '{{.Id}}' "$IMAGE")"
    RUNNING_IMAGE_ID="$(docker inspect -f '{{.Image}}' remnawave)"
    [[ "$EXPECTED_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'Cannot identify the target image'
    [ "$RUNNING_IMAGE_ID" = "$EXPECTED_IMAGE_ID" ] || fail "Panel image ID mismatch: $RUNNING_IMAGE_ID; expected $EXPECTED_IMAGE_ID"
    [ "$(docker inspect -f '{{.State.Running}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' remnawave)" = true/healthy ] ||
      fail 'Panel is not running and healthy after update'
    # Refresh installed CLI after successful update.
    install -m 755 "$RELEASE/scripts/remnadrop-cli.sh" /usr/local/bin/remnadrop
    say "Update successful: $IMAGE ($RUNNING_IMAGE_ID)"
    ;;
  *)
    fail "Unknown command '$ACTION'. Use: remnadrop help"
    ;;
esac
