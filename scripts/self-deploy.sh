#!/bin/sh
# Last step of a self-improvement: check, test and commit, then restart from outside nexus.service.
set -eu
cd "$(dirname "$0")/.."
[ $# -eq 1 ] || { echo 'Usage: self-deploy.sh "what changed"' >&2; exit 2; }
for f in public/app.js server/*.js scripts/*.js; do node --check "$f"; done
npm test --silent
git add -A
git diff --cached --quiet || git commit -qm "$1"
systemd-run --user --collect --quiet --working-directory="$PWD" "$PWD/scripts/self-restart.sh" "$(git rev-parse HEAD)"
echo 'Committed. Nexus restarts in 15 seconds.'
