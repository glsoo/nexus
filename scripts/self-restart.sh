#!/bin/sh
# Applies a deployed commit and reverts it if the server doesn't stay up.
# ponytail: only checks that the server answers for 20s; a change that breaks the page itself needs a manual git revert.
commit=$1
healthy() { [ "$(curl -s -o /dev/null -w '%{http_code}' -m 3 http://127.0.0.1:7711/api/me)" = 401 ]; }

sleep 15 # lets the bot finish its reply
systemctl --user restart nexus
i=0
while [ $i -lt 20 ]; do
  sleep 1
  i=$((i + 1))
  healthy || { [ $i -lt 10 ] && continue; break; }
  [ $i -ge 12 ] && exit 0
done

log=$(journalctl --user -u nexus -n 15 --no-pager -o cat)
if [ -n "${2:-}" ]; then # an update: go back to before the merge and don't retry this upstream commit
  git reset -q --hard "$2"; npm ci --silent >/dev/null 2>&1; git rev-parse origin/main > data/update-skip; outcome="Went back to $2."
elif git revert --no-edit "$commit" >/dev/null 2>&1; then outcome="Reverted $commit."; else outcome="Could not revert $commit automatically; fix it by hand."; fi
printf 'Deploy failed: the server did not stay up. %s\n\n%s\n' "$outcome" "$log" > data/self-deploy-failed.txt
systemctl --user restart nexus
