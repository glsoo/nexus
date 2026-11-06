<p align="center">
  <img src="docs/banner.svg" alt="Nexus — your own AI coding workspace" width="100%">
</p>

# Nexus

An AI coding agent that runs on your computer and works from any browser, including your phone. It reads and edits projects, runs commands and tests, and helps you review the changes.

[![Tests](https://github.com/glsoo/nexus/actions/workflows/test.yml/badge.svg)](https://github.com/glsoo/nexus/actions/workflows/test.yml)
[![MIT](https://img.shields.io/badge/license-MIT-111111)](LICENSE)
![Node.js 24+](https://img.shields.io/badge/node-24%2B-7e22ce)

[Get started](#get-started) · [Build quality](#build-quality) · [Phone access](#phone-access) · [Configuration](docs/configuration.md)

<img src="docs/screenshots/chat.png" alt="Nexus reading code, making changes and running tests" width="100%">

> **Nexus can access your files and shell.** Keep its login enabled, use a strong password and protect remote access with private HTTPS forwarding. Review third-party tools before installing them. Quality presets are not permission modes or a sandbox.

## Get started

### Windows

Run in PowerShell:

```powershell
irm https://raw.githubusercontent.com/glsoo/nexus/main/scripts/get-nexus.ps1 | iex
```

The installer gets missing tools through winget, installs Nexus and opens its launcher. Use **Copy Password** for your Nexus login; the launcher's **Settings** changes the login and port.

### macOS or Linux

Install **Node.js 24+** and **Git** first; install **ripgrep** for file search. Then run:

```sh
curl -fsSL https://raw.githubusercontent.com/glsoo/nexus/main/scripts/get-nexus.sh | sh
cd ~/nexus && npm start
```

The installer prints your new Nexus login once. Save it securely.

### Start building

1. Open `http://127.0.0.1:7711` and sign in.
2. Open **Settings → Models**, add a provider key and choose a model. Or start a local tool-capable model in Ollama/LM Studio.
3. Create a project, open an existing folder or clone a repository.
4. Choose **Build quality**, describe what you want and review changes in **Files** and **Changes**.

No frontend build step is needed. Prefer manual installation or want a different folder? See the [configuration guide](docs/configuration.md).

## Build quality

Choose the approach for each chat. New chats and forks inherit its selection.

| Preset | For | How it guides the agent |
| --- | --- | --- |
| **Personal · Vibe coding** | Experiments and tools for yourself | A light plan, the smallest useful implementation and basic checks |
| **Shared · Prompt engineering** | Something other people will use | Define users, narrow the scope and agree what counts as done before substantial work |
| **Commercial · Guardrails** | Work intended for a real-world release | Add project rules, meaningful tests, applicable security checks and an evidence-backed readiness checklist |

**Need help writing the request?** Choose a level, type a rough idea and click **✨ Improve this prompt**. Personal asks for a concise prototype request; Shared adds scope and acceptance criteria; Commercial adds guardrails and release checks. Review or Undo the result before pressing Send—it is never sent automatically and uses your selected model.

These are instructions for planning and verification—not a guarantee of model compliance, security certification or readiness to sell. Your model, permissions, autopilot and budget stay unchanged. Basic validation and secret protection still apply in Personal.

## What you can do

- **Edit and verify:** code-aware tools, terminal commands, automatic syntax/TypeScript checks, screenshots and a headless browser. The official **nexus-coder** and **nexus-verifier** guide and review larger tasks.
- **Review before keeping:** inspect diffs, Keep/Undo changes, rewind a prompt or fork another chat. Source control provides branches, commits and history.
- **Work in parallel:** delegate to specialist agents, optionally in separate Git worktrees, and review their returned branches.
- **Bring your setup:** existing project instructions, agents, skills and MCP servers. Marketplace adds more; inspect third-party code and endpoints first.
- **Use your preferred model:** Claude, GPT, Gemini, OpenRouter and other compatible providers, or local models. Cloud providers receive the context sent to them; local execution does not make cloud inference private to your PC.
- **Control unattended work:** budgets, request limits, scheduled tasks and optional autopilot. Autopilot approves actions on your behalf—use it deliberately. Cost displays are estimates, not billing guarantees.
- **See why something failed:** provider messages, status/code/type, request IDs and connection causes where available, with request credentials redacted. Chat/subagent errors stay in history; AI buttons offer Copy/Close details.

## Phone access

Keep Nexus running on the PC and put an **authenticated HTTPS tunnel or reverse proxy** in front of its local port. No VPN is required with services such as private Microsoft Dev Tunnels or VS Code port forwarding; see [phone setup](docs/configuration.md#phone-and-remote-access).

Open the forwarded HTTPS address in your phone browser. The tunnel-provider sign-in and **Nexus username/password are separate**. On iPhone, Safari's **Add to Home Screen** gives you an app icon; keep the PC awake and the forwarding process running.

Do not make the tunnel anonymous or disable Nexus login. Remote live preview needs its separate port/origin configured too.

## Useful commands

| Command | Purpose |
| --- | --- |
| `/help` | Show the full command list |
| `/design <request>` | Build or improve an interface |
| `/debug <problem>` · `/test <target>` | Diagnose a bug or add/run tests |
| `/review branch` · `/refactor <goal>` | Review local work or simplify code |
| `/check npm test` | Run a project check after code changes |
| `/budget 5` · `/cost` | Set a chat budget or inspect estimated spending |
| `/compact [focus]` | Summarize a long conversation; preserve a source archive |
| `/create-agent <task>` · `/create-skill <task>` | Create reusable help for your workflow |
| `@path` · `!command` | Mention a file or run your own shell command |

Skills also appear as `/commands`. Use a skill without arguments, or with `help`, for its usage.

## Safety and data

- **Permission mode** controls what tools may do; **Build quality** guides how the agent approaches the task. Neither guarantees correct output.
- An optional shell sandbox is available on Linux with bubblewrap and macOS with sandbox-exec. **No native Windows sandbox is available yet.** It primarily restricts filesystem writes; reads remain open and network blocking is optional. It does not isolate every Nexus tool, and your explicit `!command` and `/check` commands bypass it.
- Back up project `.nexus` folders and user `~/.nexus` privately. Chats, compaction archives and tool output can contain sensitive information; never commit environment files or credentials.
- Put provider keys in **Settings → Models**, not chat. Environment keys override keys saved there. Budgets are checked between model invocations and may not be an exact spending ceiling.
- Failed or incomplete compaction keeps the original model history. Large histories can require multiple summarization calls; [limits and storage details](docs/configuration.md#long-chats-and-storage) explain the trade-offs.

## Updates and development

Use **Settings → Version** to check/install updates. Nexus merges upstream, runs tests and reports failures; restart when instructed. [Advanced configuration](docs/configuration.md) covers providers, prompts, hooks and a Linux user service.

To work on Nexus itself:

```sh
npm ci
npm test
```

GitHub Actions runs the suite on Linux, macOS and Windows. Issues and pull requests are welcome. If Nexus helps you, a star makes it easier for others to find.

## License and credits

[MIT](LICENSE). Ponytail agents are adapted from [Dietrich Gebert's ponytail](https://github.com/DietrichGebert) under MIT; see [the included license](catalog/LICENSE-ponytail). Marketplace sources include [aiagentslist.com](https://aiagentslist.com) and [Hugging Face](https://huggingface.co).
