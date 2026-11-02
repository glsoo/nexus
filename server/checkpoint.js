import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { childEnv } from './util.js';

// A shadow git repo in .nexus/checkpoints.git snapshots the project before each prompt,
// without touching the project's own .git.
// ponytail: node_modules/.venv are excluded, so rewind doesn't restore them; reinstall after rewinding.
const run = promisify(execFile);
const EXCLUDE = '.nexus/\nnode_modules/\n.venv/\n__pycache__/\n';
const ID = ['-c', 'user.name=nexus', '-c', 'user.email=nexus@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];
// What git init writes. A shadow repo whose config says more (a filter, diff driver or fsmonitor runs a command) came from
// somewhere else, such as a repo that committed its own .nexus, so it's set aside instead of used.
const INIT_CONFIG = /^(core\.(repositoryformatversion|filemode|bare|logallrefupdates|symlinks|ignorecase|precomposeunicode|worktree)|extensions\.objectformat)=/;

async function git(cwd, ...args) {
  const env = { ...childEnv(), GIT_DIR: path.join(cwd, '.nexus', 'checkpoints.git'), GIT_WORK_TREE: cwd, GIT_LITERAL_PATHSPECS: '1' };
  const { stdout } = await run('git', [...ID, ...args], { cwd, env, maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  return stdout;
}

async function ensure(cwd) {
  const dir = path.join(cwd, '.nexus', 'checkpoints.git');
  if (fs.existsSync(path.join(dir, 'HEAD'))) {
    const keys = await run('git', ['config', '--file', path.join(dir, 'config'), '--list'], { env: childEnv(), windowsHide: true }).then(r => r.stdout.split('\n').filter(Boolean), () => ['unreadable']);
    if (keys.every(k => INIT_CONFIG.test(k))) return;
    console.warn(`Set aside ${dir}: its git config holds more than git init writes.`);
    fs.renameSync(dir, `${dir}.untrusted-${Date.now()}`);
  }
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await git(cwd, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'info'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'info', 'exclude'), EXCLUDE);
}

export async function snapshot(cwd, message = 'checkpoint') {
  try {
    await ensure(cwd);
    await git(cwd, 'add', '-A');
    await git(cwd, 'commit', '-q', '--allow-empty', '-m', message);
    return (await git(cwd, 'rev-parse', 'HEAD')).trim();
  } catch (err) {
    console.error('checkpoint failed:', err.message);
    return null;
  }
}

export async function restore(cwd, sha) {
  await snapshot(cwd, 'before rewind');
  await git(cwd, 'read-tree', '-u', '--reset', sha);
}

// Puts one file back as it was at the checkpoint, or deletes it if it didn't exist then.
export async function restoreFile(cwd, sha, file) {
  if (!await snapshot(cwd, `before undoing ${file}`)) throw new Error('Could not save a checkpoint first, so nothing was undone.');
  if (await git(cwd, 'cat-file', '-e', `${sha}:${file}`).then(() => true, () => false)) await git(cwd, 'checkout', sha, '--', file);
  else fs.rmSync(path.join(cwd, file), { force: true });
}

export async function diff(cwd, sha) {
  await ensure(cwd);
  await git(cwd, 'add', '-A');
  // No rename detection and no quoting, so every header names one real path that Undo file can put back.
  const out = await git(cwd, '-c', 'core.quotePath=false', 'diff', '--no-color', '--no-renames', '--no-ext-diff', sha);
  return out.length > 2_000_000 ? `${out.slice(0, 2_000_000)}\n… diff truncated …` : out;
}
