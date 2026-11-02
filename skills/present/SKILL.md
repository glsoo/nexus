---
name: present
description: Show the user a file or folder through a temporary link at /present/<id>, served by its own small server. Use when the user asks to see, preview, present, host or share a file, page, report, image or static site.
---

Run:

```bash
node /home/glso/dev/ai/scripts/present.js <file-or-folder> [--ttl 1h]
```

Give the user the printed link. It stops by itself after the TTL (default 1h, most 7d), or sooner with the printed stop command.

- A single file is served alone. HTML, images, PDF, audio and video open as they are, Markdown is rendered, other text is shown as code, and anything else downloads.
- A page with its own CSS, scripts or images needs its folder: pass the folder, which serves `index.html` or a file list.
- The link works for anyone who has it, with no login. Never present secrets (`.env`, keys, credentials). Dotfiles inside a folder are not served.
- Pages run sandboxed, so `localStorage` and cookies are unavailable, and links must be relative because the page lives under `/present/<id>/`.
