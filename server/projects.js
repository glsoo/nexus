import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { childEnv, HOME, isInside, PROJECTS, readJson, validName, writeAtomic } from './util.js';

// One project = one directory: ~/projects/<name>, which is also the agent's cwd. Its main chat is .nexus/conversation.json;
// more chats live in .nexus/chats/<id>.json and go by "<name>~<id>". Every chat of a project works in the same folder.
// A folder opened from elsewhere is a link there (a junction on Windows), so every project still has a name in ~/projects.
export const DEFAULT_MODEL = process.env.NEXUS_MODEL || 'gpt-6.1-sol';
const blank = () => ({
  model: DEFAULT_MODEL, effort: 'medium', mode: 'default', gen: 0,
  items: [], log: [], todos: [], allow: [],
  usage: { input: 0, output: 0, cached: 0, reasoning: 0, requests: 0, lastInput: 0 },
});

// The self-improvement bot's chat is a project whose directory is a link to this repo.
export const SELF = 'nexus-self';
export const chatOf = key => { const i = String(key).indexOf('~'); return i < 0 ? null : String(key).slice(i + 1); };
export const baseOf = key => String(key).split('~')[0];
const CHAT_ID = /^[a-z0-9]{1,16}$/;
export const validKey = key => validName(baseOf(key)) && (chatOf(key) === null || CHAT_ID.test(chatOf(key)));
export const projectDir = key => path.join(PROJECTS, baseOf(key));
const chatsDir = key => path.join(projectDir(key), '.nexus', 'chats');
export const stateFile = key => (chatOf(key) ? path.join(chatsDir(key), `${chatOf(key)}.json`) : path.join(projectDir(key), '.nexus', 'conversation.json'));
// A chat's title sits beside it, so the sidebar can list chats without reading whole conversations.
export const title = key => readText(path.join(chatsDir(key), `${chatOf(key)}.title`)).trim();
export function setTitle(key, text) {
  if (!chatOf(key)) throw httpError(400, "A project's main chat goes by the project's name. Rename the project instead.");
  writeAtomic(path.join(chatsDir(key), `${chatOf(key)}.title`), String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80), 0o644);
}
export function createChat(name, state = {}) {
  const key = `${baseOf(name)}~${createHash('sha256').update(`${Date.now()}${Math.random()}`).digest('hex').slice(0, 8)}`;
  writeAtomic(stateFile(key), JSON.stringify({ ...blank(), ...state }));
  return key;
}
function chats(name, dir) {
  let files = [];
  try { files = fs.readdirSync(chatsDir(name)); } catch { return []; }
  return files.filter(f => /^[a-z0-9]{1,16}\.json$/.test(f)).map(f => {
    const key = `${name}~${f.slice(0, -5)}`;
    return { name: key, parent: name, title: title(key), updated: fs.statSync(stateFile(key)).mtimeMs, ...(dir ? { dir } : {}) };
  });
}

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
      const dir = d.isSymbolicLink() ? fs.realpathSync.native(projectDir(d.name)) : undefined;
      return [{ name: d.name, updated: mtime, ...(dir ? { dir } : {}) }, ...chats(d.name, dir)];
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

// The real path of a folder a chat may work in. Checkpoints snapshot it before each prompt, which would never finish on a drive or a home folder.
export function folderPath(dir) {
  dir = String(dir || '').trim();
  let real = null;
  try { if (path.isAbsolute(dir) && fs.statSync(dir).isDirectory()) real = fs.realpathSync.native(dir); } catch { /* not there */ }
  if (!real) throw httpError(400, `There's no folder at ${dir || 'that path'}.`);
  if (path.parse(real).root === real || isInside(real, HOME) || isInside(real, PROJECTS)) {
    throw httpError(400, 'Pick a project folder, not a whole drive, your home folder or the folder that holds your projects. Nexus snapshots the folder before each prompt.');
  }
  return real;
}

// As with a cloned repo, the chat's own files (.nexus) stay out of a git repo's commits.
export function excludeNexus(dir) {
  const exclude = path.join(dir, '.git', 'info', 'exclude');
  if (!fs.existsSync(path.join(dir, '.git', 'HEAD')) || readText(exclude).split(/\r?\n/).includes('.nexus/')) return;
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  fs.appendFileSync(exclude, '\n.nexus/\n');
}

// Windows' own Select Folder dialog, which the launcher shows (windows/Nexus.exe --pick-folder) for a browser on this same PC.
const PICKER = fileURLToPath(new URL('../windows/Nexus.exe', import.meta.url));
// The browser reached Nexus by its loopback name with no tunnel or proxy headers, so it is at this computer's screen.
export const localBrowser = h => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(h.host || '')
  && !['cf-connecting-ip', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded'].some(k => h[k]);
export const canPickNatively = headers => process.platform === 'win32' && localBrowser(headers) && fs.existsSync(PICKER);
let picking = false;
// done: the chosen folder, or null when cancelled. stop() closes the dialog, for when the page stops waiting.
export function pickFolder({ title = '', button = '', start = '' } = {}, command = [PICKER]) {
  if (picking) throw httpError(409, 'A Windows folder dialog is already open. Choose a folder in it or cancel it first.');
  picking = true;
  let child;
  const done = new Promise((resolve, reject) => {
    child = execFile(command[0], [...command.slice(1), '--pick-folder', title, button, start], { encoding: 'utf8', timeout: 15 * 60_000 }, (err, out, errOut) => {
      picking = false;
      if (!err) return resolve(out.trim() || null);
      if (err.code === 1 || err.killed || err.signal) return resolve(null); // cancelled, or closed because the page stopped waiting
      reject(httpError(500, `The Windows folder dialog failed: ${String(errOut || err.message).trim()}`));
    });
  });
  return { done, stop: () => child.kill() };
}

// Opens a folder from anywhere as a project, or returns the project that already has it. The chat's files go in its .nexus.
export function open(dir) {
  const real = folderPath(dir);
  const known = list().find(p => (p.dir || fs.realpathSync.native(projectDir(p.name))) === real);
  if (known) return known.name;
  const base = path.basename(real).replace(/[^\w.-]+/g, '-').replace(/^[^a-zA-Z0-9]+/, '').slice(0, 60) || 'folder';
  fs.mkdirSync(PROJECTS, { recursive: true });
  let name = base;
  for (let n = 2; ; n++) {
    try { fs.symlinkSync(real, projectDir(name), process.platform === 'win32' ? 'junction' : 'dir'); break; } catch (err) {
      if (err.code !== 'EEXIST') throw httpError(400, `Couldn't open that folder: ${err.message}`);
      name = `${base}-${n}`;
    }
  }
  excludeNexus(real);
  return name;
}
const readText = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

export const exists = key => validKey(key) && fs.existsSync(projectDir(key)) && (!chatOf(key) || fs.existsSync(stateFile(key)));

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
  if (!exists(from) || chatOf(from)) throw httpError(404, 'Project not found.');
  if (!validName(to)) throw httpError(400, 'Names use letters, numbers, dot, dash or underscore, and start with a letter or number.');
  if (from !== to && fs.existsSync(projectDir(to))) throw httpError(409, `"${to}" already exists.`);
  fs.renameSync(projectDir(from), projectDir(to));
}

// Deleting moves to ~/projects/.trash so a misclick can be undone by hand.
// A folder opened from elsewhere only loses its link: the folder, and the chat in its .nexus, stay where they are.
export function trash(name) {
  if (!exists(name)) throw httpError(404, 'Project not found.');
  if (chatOf(name)) { // a chat goes; the project, its folder and its other chats stay
    fs.renameSync(stateFile(name), `${stateFile(name)}.deleted-${Date.now()}`);
    return fs.rmSync(path.join(chatsDir(name), `${chatOf(name)}.title`), { force: true });
  }
  if (fs.lstatSync(projectDir(name)).isSymbolicLink()) return fs.unlinkSync(projectDir(name));
  const bin = path.join(PROJECTS, '.trash');
  fs.mkdirSync(bin, { recursive: true });
  fs.renameSync(projectDir(name), path.join(bin, `${name}-${Date.now()}`));
}

// Images in the chat log are files named by their content in .nexus/images, so the log keeps a short name,
// saves and reconnects don't carry megabytes of base64, and the browser caches each image for good.
// The model's own copy (items) keeps the data URL, since the API needs it; compaction drops those.
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
export const IMAGE_FILE = /^[a-f0-9]{32}\.(png|jpg|gif|webp)$/;
export function storeImage(name, url) {
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(url));
  if (!m) return url; // a web link or anything else stays as it is
  const data = Buffer.from(m[2], 'base64');
  const file = `${createHash('sha256').update(data).digest('hex').slice(0, 32)}.${IMAGE_EXT[m[1]]}`;
  const full = path.join(projectDir(name), '.nexus', 'images', file);
  if (!fs.existsSync(full)) writeAtomic(full, data, 0o644);
  return `images/${file}`;
}

export function load(name) {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(stateFile(name), 'utf8')); } catch (err) {
    // A chat file that doesn't parse is moved aside rather than overwritten by the next save, so it can still be recovered by hand.
    if (err.code !== 'ENOENT') fs.renameSync(stateFile(name), `${stateFile(name)}.broken-${Date.now()}`);
  }
  const state = { ...blank(), ...saved };
  // Anything mid-flight when the server last stopped can never finish.
  for (const e of state.log) if (['running', 'awaiting'].includes(e.status)) e.status = 'interrupted';
  // Chats saved before images became files move theirs out on the way in.
  for (const e of state.log) if (e.images?.some(u => String(u).startsWith('data:'))) e.images = e.images.map(u => storeImage(name, u));
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

// What search and Settings need from a chat that isn't open: its messages and usage, kept until the file changes,
// so they don't parse every chat in full each time.
const peeks = new Map();
export function peek(name) {
  let mtime = 0;
  try { mtime = fs.statSync(stateFile(name)).mtimeMs; } catch { /* no chat saved yet */ }
  if (peeks.get(name)?.mtime === mtime) return peeks.get(name);
  const { log = [], usage = {} } = mtime ? readJson(stateFile(name), {}) : {};
  const out = { mtime, usage, log: log.filter(e => ['user', 'assistant'].includes(e.type) && typeof e.text === 'string').map(({ id, type, text }) => ({ id, type, text })) };
  peeks.set(name, out);
  return out;
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
