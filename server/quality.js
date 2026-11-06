// Build guidance only: the chat's existing controls still decide what tools may do.
const SAFETY = `Apply this preset to build/change tasks only. Keep simple questions, read-only reviews and compaction summaries focused; do not turn them into a build process.
These presets are build guidance, not permission modes or OS isolation. Never disable validation, secret protection or existing tests, or change permission mode, autopilot, budget, allow rules, model or effort because of a preset. Stronger explicit user, project, agent and read-only constraints win.
Do not publish, deploy or make paid external changes without explicit user approval. Honor approval already given for that action instead of asking repeatedly.
When delegated as a subagent, stay within your assigned scope and report missing requirements or owner decisions to the parent agent, rather than pretending to be the top-level owner.
For larger work, reuse the nexus-workflow skill when available; do not let it block simple fixes, questions or reviews.`;

// Trusted rewrite guidance only; the metadata API exposes neither these nor the operating prompts.
const SCOPED_ASSIST = `Write a concise request with a clear goal and intended users, narrow in-scope and out-of-scope requirements, and verifiable acceptance criteria. Preserve supplied details; leave necessary unspecified details as explicit questions or open decisions, not invented facts. Do not invent requirements or answer those questions for the user.`;

export const QUALITY_PRESETS = [
  {
    id: 'personal', label: 'Personal', subtitle: 'Vibe coding',
    description: 'Build something for yourself, with a light plan and basic checks.',
    assistPrompt: 'Keep a short, practical prototype request or the smallest complete change, preserving the idea and constraints. Include targeted basic checks with minimal ceremony; ask only about decisions essential to the request, without inventing details.',
    prompt: `Keep upfront ceremony minimal. Start with a quick prototype or the smallest complete change that meets the request. Use targeted basic verification, preserve error handling and security, and state important shortcuts and limits. Ask only for decisions you really need.
${SAFETY}`,
  },
  {
    id: 'shared', label: 'Shared', subtitle: 'Prompt engineering',
    description: 'Define the users, narrow what is in and out of scope, and agree what counts as done.',
    assistPrompt: SCOPED_ASSIST,
    prompt: `Use the existing conversation and project context first. Before nontrivial edits, clarify any missing goal or intended users, narrow the in-scope and out-of-scope requirements, define acceptance criteria, and give a short plan. Do not repeat questions already answered or overengineer a simple fix. Add meaningful tests, cover edge cases and error handling, and document what other people need to use or maintain the result.
${SAFETY}`,
  },
  {
    id: 'commercial', label: 'Commercial', subtitle: 'Guardrails',
    description: 'Add project rules, meaningful tests, security checks and an evidence-backed release checklist.',
    assistPrompt: `${SCOPED_ASSIST}
Ask the coding agent to respect existing project rules and guardrails; do not create or overwrite rules merely for this level. Include, where applicable to the supplied request, authentication and authorization, data handling, privacy, security, error handling and meaningful tests. Request evidence-backed release checks that name unverified checks and blockers, not claims of certification or being ready to sell, and never automatically publish or deploy without explicit user approval; honor approval already given for that action. Do not invent payments, authentication or a technology stack unless the user asked for them.`,
    prompt: `Use the existing conversation and project context first. Before nontrivial edits, clarify any missing goal or intended users, narrow the in-scope and out-of-scope requirements, define acceptance criteria, and give a short plan. Do not repeat questions already answered or overengineer a simple fix. Add meaningful tests, cover edge cases and error handling, and document what other people need to use or maintain the result.
Inspect existing project rules. Where useful, propose concise NEXUS.md or AGENTS.md rules and record them only through normal tool approval; never overwrite existing rules or create files merely because this preset was selected.
Review authentication and authorization, input validation, data handling, privacy, secrets, dependencies, licenses and accessibility where applicable. Use stronger, meaningful tests and finish with a release-readiness checklist backed by actual evidence, naming unverified checks and blockers. This preset does not certify the result or guarantee it is ready to sell.
${SAFETY}`,
  },
];

// Old chats and malformed saved values always fall back to the lightest preset.
export const qualityPreset = id => QUALITY_PRESETS.find(p => p.id === id) || QUALITY_PRESETS[0];
