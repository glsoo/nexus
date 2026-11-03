import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { childEnv, HOME, isInside, PROJECTS, readJson, validName, writeAtomic } from './util.js';

// One project = one conversation = one directory: ~/projects/<name>, which is also the agent's cwd.
// A folder opened from elsewhere is a link there (a junction on Windows), so every project still has a name in ~/projects.
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
    .filter(d => (d.isDirectory() || d.isSymbolicLink()) && validName(d.name))
    .flatMap(d => {
      // A linked folder that has gone away (a drive unplugged, a folder moved) is left out until it is back.
      let stat;
      try { stat = fs.statSync(projectDir(d.name)); } catch { return []; }
      if (!stat.isDirectory()) return [];
      const file = stateFile(d.name);
      const mtime = fs.existsSync(file) ? fs.statSync(file).mtimeMs : stat.mtimeMs;
      return [{ name: d.name, updated: mtime, ...(d.isSymbolicLink() ? { dir: fs.realpathSync.native(projectDir(d.name)) } : {}) }];
    })
    .sort((a, b) => b.updated - a.updated);
}

// The folders inside one folder, for picking a project folder anywhere on this computer. ~ is the home folder.
export function folders(dir) {
  dir = path.resolve(HOME, String(dir || '~').trim().replace(/^~(?=$|[\\/])/, HOME));
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { throw httpError(400, `Can't open ${dir} (${err.code}).`); }
  const isDir = d => d.isDirectory() || (d.isSymbolicLink() && (() => { try { return fs.statSync(path.join(dir, d.name)).isDirectory(); } catch { return false; } })());
  const names = entries.filter(d => !/^[.$]/.test(d.name) && isDir(d)).map(d => d.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return { path: dir, parent: path.dirname(dir) === dir ? null : path.dirname(dir), folders: names.slice(0, 1000).map(name => ({ name, path: path.join(dir, name) })) };
}

// Opens a folder from anywhere as a project, or returns the project that already has it. The chat's files go in its .nexus.
export function open(dir) {
  dir = String(dir || '').trim();
  let real = null;
  try { if (path.isAbsolute(dir) && fs.statSync(dir).isDirectory()) real = fs.realpathSync.native(dir); } catch { /* not there */ }
  if (!real) throw httpError(400, `There's no folder at ${dir || 'that path'}.`);
  const known = list().find(p => (p.dir || fs.realpathSync.native(projectDir(p.name))) === real);
  if (known) return known.name;
  // Checkpoints snapshot the whole folder before each prompt, which would never finish on a drive or a home folder.
  if (path.parse(real).root === real || isInside(real, HOME) || isInside(real, PROJECTS)) {
    throw httpError(400, 'Pick a project folder, not a whole drive, your home folder or the folder that holds your projects. Nexus snapshots the folder before each prompt.');
  }
  const base = path.basename(real).replace(/[^\w.-]+/g, '-').replace(/^[^a-zA-Z0-9]+/, '').slice(0, 60) || 'folder';
  fs.mkdirSync(PROJECTS, { recursive: true });
  let name = base;
  for (let n = 2; ; n++) {
    try { fs.symlinkSync(real, projectDir(name), process.platform === 'win32' ? 'junction' : 'dir'); break; } catch (err) {
      if (err.code !== 'EEXIST') throw httpError(400, `Couldn't open that folder: ${err.message}`);
      name = `${base}-${n}`;
    }
  }
  // As with a cloned repo, the chat's own files stay out of the repo's commits.
  const exclude = path.join(real, '.git', 'info', 'exclude');
  if (fs.existsSync(path.join(real, '.git', 'HEAD')) && !readText(exclude).split(/\r?\n/).includes('.nexus/')) {
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    fs.appendFileSync(exclude, '\n.nexus/\n');
  }
  return name;
}
const readText = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

export const exists = name => validName(name) && fs.existsSync(projectDir(name));

export function create(name) {
  fs.mkdirSync(PROJECTS, { recursive: true });
  if (!name) { let n = 1; while (fs.existsSync(projectDir(`untitled-${n}`))) n++; name = `untitled-${n}`; }
  if (!validName(name)) throw httpError(400, 'Names use letters, numbers, dot, dash or underscore, and start with a letter or number.');
  if (fs.existsSync(projectDir(name))) throw httpError(409, `"${name}" already exists.`);
  fs.mkdirSync(projectDir(name));
  return name;
}

// The parts of .nexus meant to be committed and shared with a team.
export const SHARED = ['agents', 'skills', 'commands'];

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
    // Nobody can answer a password or host-key prompt here, so those fail fast instead of hanging until the timeout.
    await promisify(execFile)('git', ['clone', '-q', '--', url, projectDir(name)], { env: { ...childEnv(), GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes' }, timeout: 600000, windowsHide: true });
  } catch (err) {
    fs.rmSync(projectDir(name), { recursive: true, force: true });
    throw httpError(400, `git clone failed: ${(err.stderr || err.message).trim().split('\n').at(-1)}`);
  }
  // Shared agents, skills and commands are fine. Anything else in a committed .nexus would be read as this chat's own state
  // (mode, approvals, /check, checkpoints), so such a repo isn't opened.
  const nexus = path.join(projectDir(name), '.nexus');
  const state = fs.existsSync(nexus) ? fs.readdirSync(nexus).filter(f => !SHARED.includes(f)) : [];
  if (state.length) {
    fs.rmSync(projectDir(name), { recursive: true, force: true });
    throw httpError(400, `This repository commits Nexus chat data (.nexus/${state[0]}), where Nexus keeps a chat's settings and approvals, so it won't open it. Shared .nexus/agents, skills and commands are fine; remove the rest from the repo.`);
  }
  // The chat's own files stay out of the repo's commits and pull requests.
  fs.mkdirSync(path.join(projectDir(name), '.git', 'info'), { recursive: true }); // a custom init.templateDir can leave it out
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
// A folder opened from elsewhere only loses its link: the folder, and the chat in its .nexus, stay where they are.
export function trash(name) {
  if (!exists(name)) throw httpError(404, 'Project not found.');
  if (fs.lstatSync(projectDir(name)).isSymbolicLink()) return fs.unlinkSync(projectDir(name));
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
