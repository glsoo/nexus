#!/bin/sh
# Last step of a self-improvement: check, test and commit, then restart from outside nexus.service.
set -eu
cd "$(dirname "$0")/.."
[ $# -eq 1 ] || { echo 'Usage: self-deploy.sh "what changed"' >&2; exit 2; }
for f in public/app.js server/*.js scripts/*.js; do node --check "$f"; done
npm test --silent
before= # set when finishing a merge, which self-restart.sh undoes by going back to this commit
[ ! -e "$(git rev-parse --git-path MERGE_HEAD)" ] || before=$(git rev-parse HEAD)
git add -A
{ [ -z "$before" ] && git diff --cached --quiet; } || git commit -qm "$1"
[ -z "$before" ] || mkdir -p data && [ -z "$before" ] || printf 'Updated to %s. Your changes were kept.\n' "$(git rev-parse --short HEAD)" > data/update-status.txt
systemd-run --user --collect --quiet --working-directory="$PWD" "$PWD/scripts/self-restart.sh" "$(git rev-parse HEAD)" ${before:+"$before"}
echo 'Committed. Nexus restarts in 15 seconds.'
