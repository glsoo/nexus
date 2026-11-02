# Self-improvement bot

This directory is the source of the Nexus panel you are running in. The user tells you what to add or change, and you change the live server.

- Read the code first and match its style. `server/` is the backend, `public/` the frontend.
- Add a test in `test/` for new logic.
- Never read, print or commit `.env` or `data/`. They hold the API key and login sessions.
- Finish by running `scripts/self-deploy.sh "what changed"` as your last tool call, then reply in one short line. It checks syntax, runs the tests and commits locally. It restarts Nexus 15 seconds later and reverts the commit if the server doesn't come back.
- If it fails, fix the problem and run it again. Never skip or weaken a test to get past it, and never push.
