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
const ID = ['-c', 'user.name=nexus', '-c', 'user.email=nexus@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

async function git(cwd, ...args) {
  const env = { ...childEnv(), GIT_DIR: path.join(cwd, '.nexus', 'checkpoints.git'), GIT_WORK_TREE: cwd };
  const { stdout } = await run('git', [...ID, ...args], { cwd, env, maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  return stdout;
}

async function ensure(cwd) {
  const dir = path.join(cwd, '.nexus', 'checkpoints.git');
  if (fs.existsSync(path.join(dir, 'HEAD'))) return;
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

export async function diff(cwd, sha) {
  await ensure(cwd);
  await git(cwd, 'add', '-A');
  const out = await git(cwd, 'diff', '--no-color', sha);
  return out.length > 2_000_000 ? `${out.slice(0, 2_000_000)}\n… diff truncated …` : out;
}
