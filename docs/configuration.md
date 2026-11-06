# Configuration and advanced setup

[Back to the README](../README.md)

## Manual installation

You need Node.js 24+, Git and ripgrep. Windows also needs Git for Windows for its Bash shell. If a `node-pty` prebuilt binary is unavailable, installation may need Python and a C/C++ build toolchain.

```sh
git clone https://github.com/glsoo/nexus.git
cd nexus
npm ci
```

On **Windows**, build and open the launcher:

```powershell
powershell -ExecutionPolicy Bypass -File windows\install.ps1 -Launch
```

The launcher creates a Nexus login. Use **Copy Password**, or change the login in its **Settings** window. This login is separate from your model-provider accounts.

On **macOS/Linux**, copy `.env.example` to `.env`, then set a login with `npm run set-password -- <username> <password>` using your own values locally. Start with `npm start`. Changing the environment file requires a server restart. Avoid leaving passwords in shared terminal history.

The one-line installers in the README handle first-run login creation for you. Set `NEXUS_DIR` before running one to choose an installation folder; `NEXUS_REPO` selects a fork. Never commit environment files or credentials.

## Environment settings

Use `.env` for terminal installs, or `windows\.env` for the Windows launcher. Most everyday options are available in the web app's **Settings**.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXUS_PORT` | `7711` | Local server port |
| `NEXUS_PROJECTS` | `~/projects` | Project holder and conversation locations |
| `NEXUS_HOME` | `~/.nexus` | User settings, model keys, prompts, agents and skills |
| `NEXUS_MODEL` | `gpt-6.1-sol` | Initial model for a new chat; choose an available model in the picker |
| `NEXUS_URL` | `http://127.0.0.1:<port>` | Address used for presented-file links |
| `NEXUS_AUTO_UPDATE` | on | Set to `0` to disable automatic update checks/installs |
| `NEXUS_PREVIEW_PORT` | server port + 1 | Separate live-preview server |
| `NEXUS_PREVIEW_URL` | unset | External address for the separate preview origin |
| `NEXUS_COMPAT` | unset | Another tool's `.name/` folders and `NAME.md` to read |

The Windows launcher chooses its initial project holder beside the installation and initializes automatic updates off. Installer choices can override the core defaults in the table. Opening an existing folder links it rather than moving its contents.

## Models and keys

Paste supported provider keys into **Settings → Models**. Environment keys take precedence over keys saved there. An environment key can therefore keep being used after you paste a replacement in Settings.

Supported environment variables include `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY` and `DASHSCOPE_API_KEY`. DashScope region selection is automatic unless you configure a base URL.

Ollama and LM Studio are discovered locally while running. Choose a tool-capable model with enough context for agent work; configure your local model server's context size if needed.

For a custom OpenAI-compatible server, add a provider under **Settings → settings.json**. This example assumes you already run an unauthenticated local gateway on port 8000:

```json
{
  "providers": {
    "work": {
      "name": "Local gateway",
      "baseURL": "http://127.0.0.1:8000/v1"
    }
  }
}
```

Add an `apiKey` property if that server requires authentication; keep it private. Model IDs use `provider:model`, such as `ollama:qwen3-coder:30b` or `work:coder`.

Costs are estimates from available provider/catalog prices. Some requests or models may be unpriced; provider billing is authoritative. Budgets are checked between model invocations, not a guaranteed exact spending ceiling.

## Phone and remote access

Nexus binds to `127.0.0.1`. Keep it there and use an authenticated HTTPS forwarder or reverse proxy for remote access. **Anyone who passes Nexus login can access the computer's files and shell.** Keep the gateway private and Nexus login enabled.

[Microsoft Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started) is one option that needs no VPN. After installing its CLI, run on the PC hosting Nexus:

```sh
devtunnel user login -g -d
devtunnel host -p 7711 --protocol http --host-header unchanged --origin-header unchanged
```

The host command stays running. Its HTTPS address requires the same GitHub account by default, followed by your separate Nexus username/password. **Do not add `--allow-anonymous`.** These commands create a temporary tunnel; see Microsoft's documentation for persistent tunnel configuration and service limits.

VS Code's **Ports → Forward a Port** is another option; keep **Port Visibility → Private**. Do not confuse the remote-editor link from `code tunnel` with a forwarded Nexus web address.

Preserve Host/Origin headers when proxying so Nexus can check request origins. Keep the computer awake, Nexus running and the forwarding process active. For a phone icon, open the HTTPS address in Safari and use **Add to Home Screen**; iPhone Web Push needs the installed web app.

Live preview uses a **different origin**. To use it remotely, forward the preview port separately and configure `NEXUS_PREVIEW_URL` to that external address, then restart Nexus. Do not merge the app under preview into Nexus's own origin.

## Agents, skills, prompts and hooks

- The **Agent** control changes the chat's role and tools. Official `nexus-coder` and `nexus-verifier` come with Nexus. Editing an official agent saves your own overriding copy.
- **Build quality** selects Personal, Shared or Commercial guidance independently of the agent and permission mode. New chats/forks inherit the source chat's choice.
- **✨ Improve this prompt** asks your selected model to rewrite a rough idea for that level. Shared/Commercial guidance leaves missing requirements as questions or open decisions rather than inventing them. The draft stays editable and is never sent automatically; Undo only restores the matching draft in its original chat. Input and generated prompts are limited to 8,000 characters, without silently truncating your request. Recognized keys/tokens/private keys are rejected, and a prior-reply excerpt containing recognized secrets is omitted; this is not a comprehensive secret scanner. Provider billing applies, and helper calls may not be included in the conversation's cost estimate.
- The **Prompts** control edits chat/project additions and the global base prompt. Its injected-text field adds text to each message. Preview shows the assembled system prompt.
- **Marketplace** installs agents, skills and MCP servers. Review third-party commands, files and endpoints before installing them.

Project extensions live in `.nexus/agents`, `.nexus/skills` and `.nexus/commands`; user extensions live under `~/.nexus`. Borrowed instructions and compatible Claude Code/Codex/VS Code skill and prompt folders are also read. Custom Markdown commands can use `$ARGUMENTS`; VS Code prompt inputs use `${input:…}`.

Hooks are configured only in user `settings.json`, not cloned projects. Events include `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `PreCompact` and `Notification`. Exit code 2 vetoes blocking actions; `PreCompact` receives the actual main/sibling state path before compaction.

## Long chats and storage

Chat state lives in each project's `.nexus` folder; additional chats use `.nexus/chats`. Model keys and user settings live under `NEXUS_HOME`. Back these up privately—conversation state and archives can contain source code, tool output and sensitive project data.

`/compact [focus]` archives exact source state in `.nexus/history` before saving a replacement summary. Oversized requests recover using chronological batches that retain actual images. Empty/incomplete summaries, failed saves and Stop do not replace the source context. Unsupported content or an image that cannot fit fails explicitly.

Compaction can make multiple model calls. Chat budgets and autopilot limits apply; the 64-invocation safety limit is not a wire-level HTTP limit because transport retries/continuations can make more requests. Summaries are capped at 32,000 characters. Larger-context models may be needed for difficult histories. Archives are not automatically pruned.

## Updates and background service

**Settings → Version** checks `origin/main`, merges updates while preserving local commits, runs tests and reports conflicts or failures. Windows rebuilds/reopens its launcher after a successful update. macOS and Linux without systemd may ask you to restart manually.

Linux user-service installs can update/restart automatically when idle. To run one, create `~/.config/systemd/user/nexus.service`; replace the two installation/Node paths below with paths on your machine:

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

Then run:

```sh
systemctl --user daemon-reload
systemctl --user enable --now nexus
journalctl --user -u nexus -f
```

Check the Node executable path with `command -v node`. Set `NEXUS_AUTO_UPDATE=0` to disable automatic update checks/installs.
