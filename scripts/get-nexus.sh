#!/bin/sh
# One-line install for macOS and Linux:
#   curl -fsSL https://raw.githubusercontent.com/glsoo/nexus/main/scripts/get-nexus.sh | sh
# Clones Nexus (or updates a clone already there), installs its dependencies and makes a login.
# NEXUS_DIR picks the folder (default ~/nexus); NEXUS_REPO installs from a fork.
set -eu
dir="${NEXUS_DIR:-$HOME/nexus}"
repo="${NEXUS_REPO:-https://github.com/glsoo/nexus.git}"
need() { command -v "$1" >/dev/null 2>&1 || { echo "Nexus needs $1. $2" >&2; exit 1; }; }
need git 'Install Git first.'
need node 'Install Node.js 24 or newer from https://nodejs.org first.'
need npm 'It comes with Node.js.'
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || { echo "Nexus needs Node.js 24 or newer, and this is $(node -v)." >&2; exit 1; }
command -v rg >/dev/null 2>&1 || echo 'Also install ripgrep (rg): Nexus uses it to search files.'

if [ -d "$dir/.git" ]; then
  echo "Updating Nexus in $dir"
  git -C "$dir" pull -q --ff-only
else
  echo "Installing Nexus into $dir"
  git clone -q "$repo" "$dir"
fi
cd "$dir"
npm ci --no-fund --no-audit --loglevel=error

# A first install gets a login with a random password, shown once. Change it any time with npm run set-password.
if [ ! -f .env ]; then
  cp .env.example .env
  user=$(id -un 2>/dev/null || echo nexus)
  pass=$(node -e 'console.log(require("node:crypto").randomBytes(12).toString("base64url"))')
  node scripts/set-password.js --linux "$user" "$pass" >/dev/null
  echo
  echo "Your login: $user / $pass"
  echo "Change it with: cd \"$dir\" && npm run set-password -- <user> <password>"
fi
echo
echo "Start Nexus with: cd \"$dir\" && npm start"
echo "Then open http://127.0.0.1:7711 and add an API key in Settings, or use Ollama or LM Studio."
