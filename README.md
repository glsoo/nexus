# Nexus

## Requirements

- Node.js 24 or newer
- `make`, `g++` and `python3`, in case `node-pty` has to compile for your platform
- An OpenAI API key, an Anthropic API key, or both

## Install

```sh
git clone https://github.com/glsoo/nexus.git
cd nexus
npm install
```

There is no build step.

## Configure

Create the login. This writes `NEXUS_USER` and `NEXUS_PASS_HASH` to `.env`:

```sh
npm run set-password -- <user> <password>
```

Then add your API keys to `.env`:

```sh
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

Never commit `.env`. It is already in `.gitignore`.

Optional settings, also in `.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXUS_PORT` | `7711` | Port to listen on |
| `NEXUS_PROJECTS` | `~/projects` | Where conversations are stored |
| `NEXUS_HOME` | `~/.nexus` | User-level settings, agents, skills and commands |
| `NEXUS_MODEL` | `gpt-6.1-sol` | Default model for new chats |
| `NEXUS_URL` | `http://127.0.0.1:<port>` | Public address used in `present` links |
| `NEXUS_AUTO_UPDATE` | on | Set to `0` to turn off automatic updates |
| `NEXUS_COMPAT` | unset | Name of another tool whose `.name/` folders and `NAME.md` should also be read |

## Run

```sh
npm start
```

Open http://127.0.0.1:7711 and log in.

The server listens on `127.0.0.1` only. To reach it from elsewhere, put an HTTPS tunnel or reverse proxy in front of it. Anyone who logs in gets shell access to the machine, so use a strong password.

## Updates

Every 6 hours, when nothing is running, Nexus fetches `origin/main` and merges it into your local branch, so your own commits stay. It then runs the tests and restarts. If the merge conflicts or the tests fail, your code stays as it was and that update is skipped until a newer one appears. Settings shows the version, your local change count and the last result, and has an Update now button.

Automatic restarts need the systemd service below.

## Test

```sh
npm test
```

## Run as a service

`~/.config/systemd/user/nexus.service`:

```ini
[Unit]
Description=Nexus

[Service]
WorkingDirectory=/path/to/nexus
ExecStart=/usr/bin/node --env-file=.env server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now nexus
journalctl --user -u nexus -f
```
