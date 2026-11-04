#!/bin/sh
# Merges upstream over local commits, so self-improvement changes stay. If anything goes wrong the code stays as it was.
set -u
cd "$(dirname "$0")/.."
mkdir -p data
say() { printf '%s\n' "$1" > data/update-status.txt; }
[ -e "$(git rev-parse --git-path MERGE_HEAD)" ] && { say 'A merge is in progress.'; exit 0; } # committing now would save its conflict markers
git fetch -q origin main || { say 'Could not reach origin.'; exit 1; }
up=$(git rev-parse origin/main)
[ "$(git rev-list --count HEAD..origin/main)" = 0 ] && { say 'Up to date.'; exit 0; }
[ "$(cat data/update-skip 2>/dev/null)" = "$up" ] && exit 0 # already failed; wait for a newer upstream commit
[ -z "$(git status --porcelain)" ] || { git add -A; git commit -qm 'Local changes before update'; }
before=$(git rev-parse HEAD)
if ! git merge -q --no-edit origin/main >/dev/null 2>&1; then
  files=$(git diff --name-only --diff-filter=U | tr '\n' ' ')
  git merge --abort
  echo "$up" > data/update-skip
  say "Update skipped: it conflicts with your changes in ${files:-the commit history}"
  exit 1
fi
lock=$(git diff --name-only "$before" HEAD -- package-lock.json)
[ -z "$lock" ] || npm ci --silent >/dev/null 2>&1
if ! npm test --silent >/dev/null 2>&1; then
  git reset -q --hard "$before"
  [ -z "$lock" ] || npm ci --silent >/dev/null 2>&1
  echo "$up" > data/update-skip
  say 'Update skipped: tests failed with your changes merged.'
  exit 1
fi
say "Updated to $(git rev-parse --short HEAD). Your changes were kept."
# Run as a systemd service, Nexus restarts itself. Anywhere else, exit 10 tells the Nexus that ran this that new code is in,
# so the Windows launcher can restart it and Settings can ask for a restart.
[ -n "${INVOCATION_ID:-}" ] && command -v systemd-run >/dev/null 2>&1 || exit 10
systemd-run --user --collect --quiet --working-directory="$PWD" "$PWD/scripts/self-restart.sh" "$(git rev-parse HEAD)" "$before"
