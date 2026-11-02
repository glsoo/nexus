import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { childEnv, PROJECTS, readJson, validName, writeAtomic } from './util.js';

// One project = one conversation = one directory: ~/projects/<name>, which is also the agent's cwd.
export const DEFAULT_MODEL = process.env.NEXUS_MODEL || 'gpt-6.1-sol';
const blank = () => ({
  model: DEFAULT_MODEL, effort: 'medium', mode: 'default', gen: 0,
  items: [], log: [], todos: [], allow: [],
  usage: { input: 0, output: 0, cached: 0, reasoning: 0, requests: 0, lastInput: 0 },
});

// The self-improvement bot's chat is a project whose directory is a link to this repo.
export const SELF = 'nexus-self';
export const projectDir = name => path.join(PROJECTS, name);
const stateFile = name => path.join(projectDir(name), '.nexus', 'conversation.json');

export function list() {
  fs.mkdirSync(PROJECTS, { recursive: true });
  return fs.readdirSync(PROJECTS, { withFileTypes: true })
    .filter(d => (d.isDirectory() || d.name === SELF) && validName(d.name))
    .map(d => {
      const file = stateFile(d.name);
      const mtime = fs.statSync(fs.existsSync(file) ? file : projectDir(d.name)).mtimeMs;
      return { name: d.name, updated: mtime };
    })
    .sort((a, b) => b.updated - a.updated);
}

export const exists = name => validName(name) && fs.existsSync(projectDir(name));

export function create(name) {
  fs.mkdirSync(PROJECTS, { recursive: true });
  if (!name) { let n = 1; while (fs.existsSync(projectDir(`untitled-${n}`))) n++; name = `untitled-${n}`; }
  if (!validName(name)) throw httpError(400, 'Names use letters, numbers, dot, dash or underscore, and start with a letter or number.');
  if (fs.existsSync(projectDir(name))) throw httpError(409, `"${name}" already exists.`);
  fs.mkdirSync(projectDir(name));
  return name;
}

// Clones a repository into a new project named after it (repo, repo-2, ...).
export async function clone(url) {
  url = String(url || '').trim();
  if (!/^(https?:\/\/|ssh:\/\/|file:\/\/|git@[\w.-]+:)\S+$/.test(url)) throw httpError(400, 'Paste an https, ssh or git@ URL, like https://github.com/owner/repo.');
  const base = url.replace(/[/]+$/, '').replace(/\.git$/, '').split(/[/:]/).pop().replace(/[^\w.-]+/g, '-').replace(/^[^a-zA-Z0-9]+/, '').slice(0, 60) || 'repo';
  fs.mkdirSync(PROJECTS, { recursive: true });
  // Claiming the folder first means a failed clone only ever removes a folder it made.
  let name = base;
  for (let n = 2; ; n++) {
    try { fs.mkdirSync(projectDir(name)); break; } catch (err) { if (err.code !== 'EEXIST') throw err; name = `${base}-${n}`; }
  }
  try {
    await promisify(execFile)('git', ['clone', '-q', '--', url, projectDir(name)], { env: { ...childEnv(), GIT_TERMINAL_PROMPT: '0' }, timeout: 600000, windowsHide: true });
  } catch (err) {
    fs.rmSync(projectDir(name), { recursive: true, force: true });
    throw httpError(400, `git clone failed: ${(err.stderr || err.message).trim().split('\n').at(-1)}`);
  }
  // The chat's own files stay out of the repo's commits and pull requests.
  fs.appendFileSync(path.join(projectDir(name), '.git', 'info', 'exclude'), '\n.nexus/\n');
  return name;
}

export function rename(from, to) {
  if (!exists(from)) throw httpError(404, 'Project not found.');
  if (!validName(to)) throw httpError(400, 'Names use letters, numbers, dot, dash or underscore, and start with a letter or number.');
  if (from !== to && fs.existsSync(projectDir(to))) throw httpError(409, `"${to}" already exists.`);
  fs.renameSync(projectDir(from), projectDir(to));
}

// Deleting moves to ~/projects/.trash so a misclick can be undone by hand.
export function trash(name) {
  if (!exists(name)) throw httpError(404, 'Project not found.');
  const bin = path.join(PROJECTS, '.trash');
  fs.mkdirSync(bin, { recursive: true });
  fs.renameSync(projectDir(name), path.join(bin, `${name}-${Date.now()}`));
}

export function load(name) {
  const state = { ...blank(), ...readJson(stateFile(name), {}) };
  // Anything mid-flight when the server last stopped can never finish.
  for (const e of state.log) if (['running', 'awaiting'].includes(e.status)) e.status = 'interrupted';
  repairItems(state.items);
  return state;
}

// The API rejects a function_call with no output, which a crash or restart mid-tool can leave behind.
export function repairItems(items) {
  const answered = new Set(items.filter(i => i.type === 'function_call_output').map(i => i.call_id));
  for (const i of [...items]) {
    if (i.type === 'function_call' && !answered.has(i.call_id)) items.push({ type: 'function_call_output', call_id: i.call_id, output: 'Interrupted before this tool finished.' });
  }
}

// An image the API refuses would otherwise fail every later turn, since history is replayed in full.
export function dropImages(items) {
  const note = '[image removed: the API rejected it]';
  let dropped = 0;
  for (const i of items) {
    if (i.type === 'function_call_output' && Array.isArray(i.output)) { i.output = note; dropped++; }
    if (Array.isArray(i.content)) i.content = i.content.map(c => c.type === 'input_image' ? (dropped++, { type: 'input_text', text: note }) : c);
  }
  return dropped;
}

export const save = (name, state) => writeAtomic(stateFile(name), JSON.stringify(state));

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
