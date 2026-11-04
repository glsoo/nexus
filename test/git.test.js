import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-git-'));
for (const [k, v] of Object.entries({ GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' })) process.env[k] = v;
const repo = await import('../server/git.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("source control: status, commit without the chat's .nexus, branches, history and a commit's diff", async () => {
  const dir = path.join(tmp, 'p');
  fs.mkdirSync(path.join(dir, '.nexus'), { recursive: true });
  assert.deepEqual(await repo.overview(dir), { repo: false });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(dir, '.nexus', 'conversation.json'), '{}');

  let g = await repo.overview(dir);
  assert.equal(g.branch, 'main');
  assert.deepEqual(g.files, [{ status: '??', path: 'a.txt' }], "the chat's own files aren't offered for commit");
  assert.match(await repo.pending(dir), /New files:\na\.txt/);
  await assert.rejects(repo.act(dir, { action: 'commit', message: ' ' }), /commit message/);
  await repo.act(dir, { action: 'commit', message: 'First commit' });
  assert.equal(execFileSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' }).trim(), 'a.txt', '.nexus stays out of the commit');

  await repo.act(dir, { action: 'create', branch: 'feature/x' });
  await assert.rejects(repo.act(dir, { action: 'create', branch: '--force' }), /name/);
  await assert.rejects(repo.act(dir, { action: 'switch', branch: 'bad..name' }), /valid branch name/);
  fs.appendFileSync(path.join(dir, 'a.txt'), 'two\n');
  await repo.act(dir, { action: 'commit', message: 'Second line' });
  g = await repo.overview(dir);
  assert.equal(g.branch, 'feature/x');
  assert.deepEqual(g.branches.sort(), ['feature/x', 'main']);
  assert.deepEqual(g.log.map(c => c.subject), ['Second line', 'First commit']);
  assert.match(await repo.show(dir, g.log[0].hash), /Second line[\s\S]*\+two/);
  await assert.rejects(repo.show(dir, 'HEAD; rm -rf /'), /Not a commit/);
  await repo.act(dir, { action: 'switch', branch: 'main' });
  assert.equal((await repo.overview(dir)).branch, 'main');
  await assert.rejects(repo.act(dir, { action: 'push' }), /origin|remote|repository/i, 'no remote to push to');
});
