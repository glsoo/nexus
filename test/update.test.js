import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { shellCommand } from '../server/util.js';

const script = fileURLToPath(new URL('../scripts/update.sh', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'update-'));
const bin = path.join(tmp, 'bin');
const restarted = path.join(tmp, 'restarted');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'systemd-run'), `#!/bin/sh\necho "$@" > "${restarted.replaceAll('\\', '/')}"\n`, { mode: 0o755 });
const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const write = (dir, file, text) => fs.writeFileSync(path.join(dir, file), text);
const save = (dir, msg) => { git(dir, 'add', '-A'); git(dir, 'commit', '-qm', msg); };

// A fresh upstream and clone, with a local commit made in the clone.
function setup(name) {
  const up = path.join(tmp, `${name}-up`), local = path.join(tmp, `${name}-local`);
  fs.mkdirSync(up);
  git(up, 'init', '-qb', 'main');
  write(up, 'package.json', '{"scripts":{"test":"exit 0"}}');
  write(up, '.gitignore', 'data/\n');
  write(up, 'shared.txt', 'base\n');
  save(up, 'base');
  git(tmp, 'clone', '-q', up, local);
  fs.mkdirSync(path.join(local, 'scripts'));
  fs.writeFileSync(path.join(local, 'scripts/update.sh'), fs.readFileSync(script, 'utf8').replaceAll('\r\n', '\n'), { mode: 0o755 });
  write(local, 'mine.txt', 'my change\n');
  save(local, 'my change');
  fs.rmSync(restarted, { force: true });
  return { up, local };
}
function update(local) {
  try { execFileSync(shellCommand(), [path.join(local, 'scripts/update.sh').replaceAll('\\', '/')], { env, stdio: 'ignore' }); return 0; } catch (err) { return err.status; }
}
const status = local => fs.readFileSync(path.join(local, 'data/update-status.txt'), 'utf8');

test('an update merges upstream, keeps local and uncommitted changes, and restarts', () => {
  const { up, local } = setup('ok');
  write(up, 'new.txt', 'upstream\n');
  save(up, 'upstream');
  write(local, 'loose.txt', 'not committed\n');
  assert.equal(update(local), 0);
  for (const f of ['mine.txt', 'new.txt', 'loose.txt']) assert.ok(fs.existsSync(path.join(local, f)), f);
  assert.ok(fs.existsSync(restarted));
  assert.equal(git(local, 'status', '--porcelain'), '');
});

test('nothing new means no restart', () => {
  const { local } = setup('none');
  assert.equal(update(local), 0);
  assert.match(status(local), /Up to date/);
  assert.ok(!fs.existsSync(restarted));
});

test('a conflict leaves the code alone and is not retried', () => {
  const { up, local } = setup('conflict');
  write(local, 'shared.txt', 'mine\n');
  save(local, 'mine');
  write(up, 'shared.txt', 'theirs\n');
  save(up, 'theirs');
  const before = git(local, 'rev-parse', 'HEAD');
  assert.equal(update(local), 1);
  assert.equal(git(local, 'rev-parse', 'HEAD'), before);
  assert.equal(git(local, 'status', '--porcelain'), '');
  assert.match(status(local), /shared\.txt/);
  assert.equal(update(local), 0);
  assert.ok(!fs.existsSync(restarted));
});

test('failing tests roll the merge back', () => {
  const { up, local } = setup('broken');
  write(up, 'package.json', '{"scripts":{"test":"exit 1"}}');
  save(up, 'broken');
  const before = git(local, 'rev-parse', 'HEAD');
  assert.equal(update(local), 1);
  assert.equal(git(local, 'rev-parse', 'HEAD'), before);
  assert.ok(fs.existsSync(path.join(local, 'mine.txt')));
  assert.ok(!fs.existsSync(restarted));
});
