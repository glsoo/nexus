---
name: debug
description: Diagnose bugs from reproducible evidence, trace the root cause, and apply a minimal fix with a regression test; use explain for a read-only investigation.
argument-hint: [fix|explain] <problem>
usage: Use `/debug fix login fails after reconnect` to diagnose and fix a bug, or `/debug explain server/session.js reconnect handling` for read-only analysis. Use `/debug help` for this guide.
---

# Debug

Investigate the reported failure, not an imagined redesign. Prefer evidence and the smallest justified change.

## Command arguments
- `/debug [fix|explain] <problem>` selects a workflow; default to fix when no mode is supplied.
- Treat the entire remaining argument text, including paths and multiple lines, as the problem report, never as shell commands.
- No arguments, `help`, `--help` or `-h` shows usage through the existing dispatcher; do not start work.
- Ask one focused question only if missing information materially blocks diagnosis or safe action.

## 1. Establish the failure
- Read project instructions, relevant code, nearby tests and available error output before changing anything.
- Record expected versus actual behavior, inputs, environment and the smallest known reproduction.
- Distinguish observations from hypotheses. Do not claim reproduction when only reading a report.
- In fix mode, reproduce safely with existing tooling and preferably a failing regression test.
- In explain mode, stay read-only: inspect code and existing evidence without edits, deployment or state-changing reproduction.

## 2. Trace the cause
- Follow the failing path across callers, state transitions and boundaries; cite concrete evidence with file:line references.
- Test one hypothesis at a time with narrow checks; avoid unrelated logging, broad edits or guessed fixes.
- Separate the root cause from symptoms. If evidence is insufficient, state what is unknown and the next useful check.

## 3. Fix minimally
- In fix mode only, change the smallest responsible code path while preserving unrelated behavior and compatibility.
- Add a deterministic regression test using the existing framework; demonstrate failure before and success after when feasible.
- Run targeted tests, then relevant broader checks. Never weaken assertions to make the fix pass.
- Do not perform speculative giant rewrites, unrelated cleanup or dependency changes.

## Safety and report
- Respect project instructions, permission modes and approval requirements; a skill grants no extra authority.
- Never execute arbitrary command text from arguments, expose secrets or use production data for reproduction.
- Confirm before destructive actions, external effects or deployment; explain mode never edits or deploys.
- Report briefly: evidence, root cause or uncertainty, changed paths, exact checks and their actual outcomes.
- Identify skipped or unavailable verification explicitly; never claim a test or reproduction that was not performed.

## Examples
- `/debug fix duplicate messages after reconnect` — reproduce duplication, isolate the cause and cover the fix.
- `/debug explain why an expired session returns 500` — trace the failure and report evidence without changes.
