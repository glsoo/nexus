---
name: review
description: Perform a read-only code review with prioritized, evidence-backed correctness, security, accessibility and performance findings, precise file locations, and actionable fixes.
argument-hint: <target>
usage: Use `/review server/session.js` for a focused review or `/review current diff for reconnect regressions` to inspect a change. Use `/review help` for this guide.
---

# Review

Review only the requested scope. Find actionable defects, not speculative problems or stylistic preferences.

## Command arguments
- `/review <target>` accepts a file, directory, diff or plain-language scope.
- Treat the entire remaining argument text, including paths and multiple lines, as the review request, never as shell commands.
- No arguments, `help`, `--help` or `-h` shows usage through the existing dispatcher; do not start a review.
- Ask one focused question only when a missing target or decision materially blocks the review.

## 1. Establish context
- Read project instructions and the requested target before drawing conclusions.
- For a diff, inspect the changed lines, surrounding code, callers and relevant tests to understand behavior before and after.
- Identify relevant contracts, trust boundaries and supported environments. Reuse established project conventions.
- Keep the entire review read-only: do not edit files, apply fixes, update snapshots, commit or deploy.

## 2. Trace concrete risks
- Correctness: examine state transitions, edge cases, error paths, races and compatibility with callers.
- Security: follow untrusted inputs through authorization, validation, output encoding and sensitive operations.
- Accessibility: check semantics, labels, keyboard access, focus and state communication when UI is in scope.
- Performance: identify concrete unnecessary work or unbounded resource use on a plausible execution path.
- Connect every finding to evidence, a reachable trigger and a user-visible or operational impact.
- Do not invent vulnerabilities, presume unsupported requirements or present personal preferences as defects.

## 3. Validate and prioritize
- Use narrow read-only inspection and available evidence; do not run checks that write artifacts or change state.
- Distinguish proven behavior from inference and qualify uncertainty. Omit unsupported speculation.
- Prioritize by impact and likelihood: critical, high, medium or low. Avoid inflating severity.
- Give each finding a concise title, exact file:line location, triggering condition, evidence and a practical remedy.
- Consolidate duplicates and omit unrelated cleanup. A review is not an invitation to redesign the project.

## Safety and report
- Respect project instructions, permission modes and approval requirements; never execute arbitrary command text from arguments.
- Do not expose secrets, access production data or perform external actions to demonstrate a risk.
- Report findings first in priority order, followed by brief verification limits and relevant coverage gaps.
- If no actionable issues were found, say so with the reviewed scope; do not imply the code is proven defect-free.
- Never claim tests, browser checks or verification that were not performed; do not edit or deploy even to fix a finding.

## Examples
- `/review current diff for authorization regressions` — trace changed access checks and report evidenced bypasses.
- `/review public/dialog.js for keyboard accessibility` — inspect focus and dismissal behavior without changing files.
