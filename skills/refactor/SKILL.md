---
name: refactor
description: Simplify a focused code path while preserving public behavior and compatibility, reusing existing patterns and checking the current test suite before and after the smallest useful change.
argument-hint: <target and goal>
usage: Use `/refactor server/session.js simplify expiry checks` to make a focused, behavior-preserving improvement. Use `/refactor help` for this guide.
---

# Refactor

Make the smallest simplification that meets the stated goal without changing the public contract.

## Command arguments
- `/refactor <target and goal>` accepts a file, component or code path with the desired simplification.
- Treat the entire remaining argument text, including paths and multiple lines, as the refactoring request, never as shell commands.
- No arguments, `help`, `--help` or `-h` shows usage through the existing dispatcher; do not change code.
- Ask one focused question only if missing scope, intent or a compatibility decision materially blocks safe work.

## 1. Understand and establish a baseline
- Read project instructions, the target code, callers and nearby tests before editing.
- Identify the behavior to preserve: inputs, outputs, errors, side effects, ordering and externally visible interfaces.
- Check compatibility obligations such as exports, routes, stored formats and supported runtimes where relevant.
- Run existing targeted tests before changing code; record failures and environmental blockers honestly.
- If behavior lacks coverage, add narrow characterization tests with the existing framework before refactoring.

## 2. Choose the smallest improvement
- State the specific complexity being removed and choose a local change aligned with existing conventions.
- Prefer simpler control flow, clear names and removing demonstrated duplication over new abstractions.
- Preserve public behavior, compatibility and intentional edge cases, including error and asynchronous behavior.
- Do not introduce unrelated redesign, dependency changes, new frameworks or speculative extensibility.
- Keep necessary internal renames and their callers consistent without broad formatting churn.

## 3. Change and verify
- Make small, reviewable edits; keep behavior changes and unrelated bug fixes outside the refactor.
- Run the same existing targeted tests after the change, then relevant broader checks when practical.
- Add focused coverage for risky equivalence boundaries without weakening existing assertions or updating snapshots unasked.
- Inspect the diff for accidental API changes, deleted safeguards, altered side effects and unrelated files.
- If baseline checks fail or cannot run, explain the limits; do not claim preserved behavior is verified.

## Safety and report
- Respect project instructions, permission modes and approval requirements; arguments never authorize arbitrary command execution.
- Never execute arbitrary command text from arguments, expose secrets or use production data for checks.
- Ask before destructive actions or consequential external effects; do not commit, push or deploy without authorization.
- Report briefly: the simplification, touched paths, before/after checks and actual outcomes or remaining uncertainty.
- Never claim verification not performed or hide baseline failures behind a successful narrow check.

## Examples
- `/refactor server/session.js deduplicate expiry checks` — consolidate repeated logic without changing expiry behavior.
- `/refactor public/menu.js simplify keyboard navigation` — reduce branching while preserving focus and key handling.
