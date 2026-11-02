import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { scryptSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { killGroup } from '../server/tools.js';

test('Unix termination still targets a group after its leader exits', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalKill = process.kill;
  let killed;
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.kill = (pid, signal) => { killed = { pid, signal }; return true; };
    killGroup({ pid: 424242, exitCode: 0, signalCode: null }, 'SIGKILL');
    assert.deepEqual(killed, { pid: -424242, signal: 'SIGKILL' });
  } finally {
    process.kill = originalKill;
    Object.defineProperty(process, 'platform', platform);
  }
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus windows #'));
  const scripts = path.join(dir, 'scripts');
  fs.mkdirSync(scripts);
  const script = path.join(scripts, 'set-password.js');
  fs.copyFileSync(fileURLToPath(new URL('../scripts/set-password.js', import.meta.url)), script);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env };
  for (const key of ['NEXUS_USER', 'NEXUS_PASS_HASH', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NEXUS_PORT']) delete env[key];
  return {
    dir,
    run: (mode, input) => execFileSync(process.execPath, [script, '--windows', mode], {
      input: input === undefined ? undefined : JSON.stringify(input), env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }),
    read: () => parseEnv(fs.readFileSync(path.join(dir, 'windows', '.env'), 'utf8')),
  };
}

test('Windows setup hashes credentials over stdin and returns no secrets', t => {
  const f = fixture(t);
  assert.equal(JSON.parse(f.run('--status')).configured, false);
  assert.equal(f.run('--stdin', { user: 'analyst', pass: 'fixture-password', settings: { OPENAI_API_KEY: 'fixture-api-key', NEXUS_AUTO_UPDATE: '0' } }).trim(), '.env updated');
  const status = JSON.parse(f.run('--status'));
  assert.deepEqual(status, { configured: true, user: 'analyst', port: 7711, openai: true, anthropic: false });
  assert.doesNotMatch(JSON.stringify(status), /fixture-password|fixture-api-key/);
  const settings = f.read();
  const [salt, hash] = settings.NEXUS_PASS_HASH.split(':');
  assert.equal(hash, scryptSync('fixture-password', salt, 64).toString('hex'));
  assert.equal(settings.OPENAI_API_KEY, 'fixture-api-key');
  assert.equal(fs.existsSync(path.join(f.dir, '.env')), false);
});

test('Windows settings preserve existing credentials and reject line injection', t => {
  const f = fixture(t);
  f.run('--stdin', { user: 'analyst', pass: 'fixture-password', settings: { OPENAI_API_KEY: 'fixture-api-key' } });
  const before = f.read();
  f.run('--stdin', { user: 'analyst', settings: { NEXUS_PORT: '7722' } });
  const after = f.read();
  assert.equal(after.NEXUS_PASS_HASH, before.NEXUS_PASS_HASH);
  assert.equal(after.OPENAI_API_KEY, before.OPENAI_API_KEY);
  assert.equal(after.NEXUS_PORT, '7722');
  assert.throws(() => f.run('--stdin', { user: 'analyst', settings: { OPENAI_API_KEY: 'bad\nNEXUS_USER=other' } }));
  assert.throws(() => f.run('--stdin', { user: 'analyst', settings: { NEXUS_PORT: '70000' } }));
  assert.deepEqual(f.read(), after);
});