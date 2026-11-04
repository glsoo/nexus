---
name: nexus-workflow
description: The official Nexus Coder workflow for bugs, features, multi-file changes and refactors. Five stages with gates (Understand, Plan, Build, Verify, Report) so work is checked, safe and cheap before it is called done.
argument-hint: <task>
usage: Runs a task through the five stages, showing them as the task list. For example `/nexus-workflow fix the login timeout on slow networks` or `/nexus-workflow add CSV export to the reports page`. The nexus-coder agent uses it by itself for anything bigger than a small fix.
---

# Nexus workflow

Run the task through these five stages in order. Start a TodoWrite list with one item per stage (Understand, Plan, Build, Verify, Report), add the plan's steps under Build when you have them, and keep it current so the user can follow along. A stage's gate must hold before the next stage starts. If the task turns out to be a question or a one-line fix, say so, do it directly and skip to Report.

## 1. Understand
- Say the goal in one sentence, and how you will know it's done: a test that passes, a command whose output changes, something visible on screen.
- Find the code: Glob and Grep first, then Read the parts that matter. For a wide or unfamiliar area, send an Explore subagent and work from its conclusions.
- For a bug, reproduce it now: a failing test, a command or the exact error. If you can't reproduce it, say so and collect evidence before you change anything.
- If a choice changes what gets built and only the user can make it, ask with AskUserQuestion and offer options. Otherwise pick the sensible default and note the assumption.

Gate: the goal, the done check and the relevant code are known. For a bug: reproduced, or its absence explained.

## 2. Plan
- List every place the change must reach: callers, tests, fixtures, config, exports, docs, migrations.
- Pick the cheapest approach that fully works, in this order: code the project already has, the standard library or platform, a dependency already installed, then new code. Check that every API, flag and option you plan to use really exists (grep, the installed source, `--help`, official docs).
- Name the risks: security at trust boundaries, data loss, breaking existing users, performance on hot paths.
- Turn the plan into Build steps in the task list. If the work is large or the approach is a real choice, show the plan in a few lines first (in plan mode, with ExitPlanMode) and wait for approval.

Gate: every touch point and risk is listed, and every API in the plan is confirmed to exist.

## 3. Build
- One step at a time. Read a file before editing it; prefer Edit over rewriting; match the code around it.
- For a bug, write the failing test first, then fix the root cause once, in the shared code.
- After each step run the nearest test, or the code itself, before moving on.
- Never weaken validation, auth or error handling to get past an error. After two failed attempts at the same fix, go back to Understand: the cause is probably not what you think.
- Destructive or outside-visible commands need the user's go-ahead unless they already gave it.

Gate: every Build step is done, and its nearest test or run passes.

## 4. Verify
- Run the full test suite once, and the build, linter or type check if the project has them. Keep the output short (`| tail -n 40`).
- Run the real thing: the command, the endpoint, the page. For UI, use the Browser tool to click through what changed and check its console for errors, or at least look at it with Screenshot.
- Read your own `git diff` and check: no secrets, no debug output or leftovers, nothing unrelated changed, every caller and test updated, errors handled, new logic tested.
- After a large or risky change, launch the nexus-verifier subagent with the request and a summary of what you changed. Fix what it confirms and re-run the affected checks.

Gate: there is evidence for every claim you are about to make. Anything you couldn't run is labeled "not verified" with the reason.

## 5. Report
Keep it to a few lines:
- **Done:** what changed, with path:line.
- **Verified:** the commands you ran and the result line that proves it.
- **Not done or not verified:** what you skipped, assumed or couldn't check, and any risk the user must know.
