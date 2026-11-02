import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv, HOME, NEXUS_HOME, readSettings, shellCommand, validName, writeAtomic } from './util.js';

export const BUILTIN_AGENTS = [
  { name: 'general-purpose', description: 'Multi-step research and coding tasks.', tools: null, builtin: true,
    prompt: 'You are a subagent. Complete the task fully, then report what you did and what you found.' },
  { name: 'Explore', description: 'Fast read-only codebase search. Returns conclusions, not file dumps.', tools: ['Read', 'Glob', 'Grep'], builtin: true,
    prompt: 'You are a read-only search subagent. Locate what was asked for and report file paths with line numbers and your conclusion.' },
  { name: 'Plan', description: 'Read-only architect that returns a step-by-step implementation plan.', tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'web_search'], builtin: true,
    prompt: 'You are a software architect subagent. Read the relevant code and return a concrete step-by-step plan naming the files to change. Do not change anything.' },
];

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const meta = {};
  if (!m) return { meta, body: text };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: text.slice(m[0].length) };
}

function mdFiles(dir) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => path.join(dir, f)); } catch { return []; }
}

// NEXUS_COMPAT=name also reads .name/{agents,skills,commands} and NAME.md, for folders shared with another tool.
const compat = (root, sub) => process.env.NEXUS_COMPAT ? [path.join(root, `.${process.env.NEXUS_COMPAT}`, sub)] : [];
const parseTools = s => s ? s.split(',').map(t => t.trim()).filter(Boolean) : null;

export function agentDefs(cwd) {
  const defs = new Map(BUILTIN_AGENTS.map(a => [a.name, a]));
  const scopes = [...compat(HOME, 'agents').map(d => ['user', d]), ['user', path.join(NEXUS_HOME, 'agents')],
    ...compat(cwd, 'agents').map(d => ['project', d]), ['project', path.join(cwd, '.nexus/agents')]];
  for (const [scope, dir] of scopes) for (const file of mdFiles(dir)) {
    const { meta, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    const name = meta.name || path.basename(file, '.md');
    defs.set(name, { name, description: meta.description || '', tools: parseTools(meta.tools), model: meta.model || undefined, prompt: body, scope, file });
  }
  return [...defs.values()];
}

export function saveAgentDef(cwd, scope, def) {
  if (!validName(def.name)) throw Object.assign(new Error('Invalid agent name.'), { status: 400 });
  const dir = scope === 'project' ? path.join(cwd, '.nexus/agents') : path.join(NEXUS_HOME, 'agents');
  const oneLine = s => String(s ?? '').replace(/[\r\n]+/g, ' ');
  const lines = [`name: ${def.name}`, `description: ${oneLine(def.description)}`];
  if (def.tools?.length) lines.push(`tools: ${def.tools.map(oneLine).join(', ')}`);
  if (def.model) lines.push(`model: ${oneLine(def.model)}`);
  writeAtomic(path.join(dir, `${def.name}.md`), `---\n${lines.join('\n')}\n---\n${def.prompt || ''}\n`, 0o644);
}

export function deleteAgentDef(cwd, name) {
  if (!validName(name)) return;
  for (const dir of [path.join(cwd, '.nexus/agents'), path.join(NEXUS_HOME, 'agents')]) fs.rmSync(path.join(dir, `${name}.md`), { force: true });
}

export function skills(cwd) {
  const out = new Map();
  for (const root of [fileURLToPath(new URL('../skills', import.meta.url)), ...compat(HOME, 'skills'), path.join(NEXUS_HOME, 'skills'), ...compat(cwd, 'skills'), path.join(cwd, '.nexus/skills')]) {
    let names = [];
    try { names = fs.readdirSync(root); } catch { continue; }
    for (const n of names) {
      const file = path.join(root, n, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const { meta, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
      out.set(meta.name || n, { name: meta.name || n, description: (meta.description || '').slice(0, 300), argumentHint: meta['argument-hint'] || '', usage: meta.usage || '', body, dir: path.dirname(file) });
    }
  }
  return [...out.values()];
}

export function commands(cwd) {
  const out = new Map();
  for (const dir of [...compat(HOME, 'commands'), path.join(NEXUS_HOME, 'commands'), ...compat(cwd, 'commands'), path.join(cwd, '.nexus/commands')]) {
    for (const file of mdFiles(dir)) {
      const { meta, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
      const name = path.basename(file, '.md');
      out.set(name, { name, description: meta.description || 'Custom command', body });
    }
  }
  return [...out.values()];
}

// A repo set up for another tool keeps its rules. AGENTS.md is the shared standard, so it wins over these to avoid reading the same rules twice.
const BORROWED = ['CLAUDE.md', 'GEMINI.md', '.cursorrules', '.windsurfrules', '.github/copilot-instructions.md', 'CONVENTIONS.md'];

export function instructions(cwd) {
  const parts = [];
  const borrowed = fs.existsSync(path.join(cwd, 'AGENTS.md')) ? [] : BORROWED.map(f => path.join(cwd, f)).filter(f => fs.existsSync(f)).slice(0, 1);
  for (const file of new Set([path.join(NEXUS_HOME, 'NEXUS.md'), ...(process.env.NEXUS_COMPAT ? [path.join(cwd, `${process.env.NEXUS_COMPAT.toUpperCase()}.md`)] : []), ...borrowed, path.join(cwd, 'AGENTS.md'), path.join(cwd, 'NEXUS.md')])) {
    try { parts.push(`Contents of ${file}:\n${fs.readFileSync(file, 'utf8').slice(0, 40000)}`); } catch { /* optional file */ }
  }
  return parts.join('\n\n');
}

// Hooks live only in the global settings file, so a cloned repo can't bring its own commands.
// A hook exiting with code 2 blocks the action and its stderr becomes the reason.
export async function runHooks(event, payload, cwd) {
  const hooks = readSettings().hooks?.[event] || [];
  for (const hook of hooks) {
    if (hook.matcher && payload.tool && !new RegExp(hook.matcher).test(payload.tool)) continue;
    const result = await new Promise(resolve => {
      const proc = spawn(shellCommand(), ['-c', hook.command], { cwd, env: childEnv(), windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'], timeout: 60000 });
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d; });
      proc.on('error', err => resolve({ code: 1, stderr: err.message }));
      proc.on('close', code => resolve({ code, stderr }));
      proc.stdin.on('error', () => {});
      proc.stdin.end(JSON.stringify({ event, cwd, ...payload }));
    });
    if (result.code === 2) return { blocked: true, reason: result.stderr.trim() || `Blocked by ${event} hook` };
  }
  return { blocked: false };
}
