---
name: test
description: Write or run focused tests with the project's existing framework, emphasizing deterministic edge cases and regressions, meaningful assertions, and truthful verification results.
argument-hint: [write|run] <target>
usage: Use `/test write server/session.js expiry handling` to add focused coverage, or `/test run test/session.test.js` to execute existing tests. Use `/test help` for this guide.
---

# Test

Build confidence in the requested behavior with small, meaningful tests, not coverage theater.

## Command arguments
- `/test [write|run] <target>` selects a workflow; default to write when no mode is supplied.
- Treat the entire remaining argument text, including paths and multiple lines, as the testing request, never as shell commands.
- No arguments, `help`, `--help` or `-h` shows usage through the existing dispatcher; do not run tests.
- Ask one focused question only if missing scope or expected behavior materially blocks useful testing.

## 1. Discover the existing approach
- Read project instructions, test scripts, nearby tests and the target implementation before changing anything.
- Reuse the current framework, fixtures, helpers and naming conventions. Do not install a testing framework.
- Identify the behavioral contract and relevant edge cases rather than duplicating implementation details.
- Inspect scripts before running them; choose the narrowest appropriate command and safe local environment.

## 2. Write mode
- Add focused cases for the requested behavior, meaningful boundaries, invalid inputs and known regressions.
- Keep tests deterministic: control time, randomness, network and concurrency where relevant using existing facilities.
- Use isolated synthetic fixtures; clean up temporary resources and restore mocks, clocks and environment changes.
- Assert observable outcomes and failure paths. Avoid sleeps, brittle internals and assertions that cannot fail meaningfully.
- For regressions, show the test fails for the bug and passes for the fix when feasible; label any unverified step.
- Do not change production behavior merely to obtain a green suite; report discovered bugs separately unless fixing is requested.

## 3. Run and interpret
- In run mode, execute existing checks without editing source, tests, lockfiles or snapshots.
- Run targeted tests first, then relevant broader checks if practical; report the scope actually exercised.
- Distinguish assertion failures from missing dependencies, unavailable services, timeouts and test discovery failures.
- Never weaken assertions, skip failing cases, loosen thresholds or update snapshots without an explicit request.

## Safety and report
- Respect project instructions, permission modes and approval requirements; arguments never authorize arbitrary command execution.
- Do not use production data, expose secrets or contact live services without authorization; prefer isolated local doubles.
- Do not install frameworks, deploy or perform destructive setup as a shortcut. Ask before consequential external effects.
- Report briefly: added coverage, commands run, actual pass/fail/skip outcomes and any blockers or remaining gaps.
- Never claim verification not performed or describe an unrun test as passing.

## Examples
- `/test write pagination boundaries in server/search.js` — cover empty results, limits and the final page.
- `/test run test/session.test.js` — execute the existing file and summarize its real outcome without edits.
