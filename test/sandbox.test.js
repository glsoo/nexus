import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sandbox-'));
process.env.NEXUS_HOME = path.join(tmp, 'home');
fs.mkdirSync(process.env.NEXUS_HOME, { recursive: true });
const settings = path.join(process.env.NEXUS_HOME, 'settings.json');
const sandbox = await import('../server/sandbox.js');
const { execTool } = await import('../server/tools.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const project = path.join(tmp, 'project');
fs.mkdirSync(project);
const realProject = fs.realpathSync.native(project);

test('the sandbox command: project and temp writable, the rest read-only, network optional', () => {
  const [cmd, args] = sandbox.wrap('bash', ['-c', 'ls'], [project], { platform: 'linux', network: false, tool: 'bubblewrap' });
  assert.match(cmd, /bwrap$/);
  assert.deepEqual(args.slice(0, 2), ['--ro-bind', '/']);
  assert.ok(args.join(' ').includes(`--bind-try ${realProject} ${realProject}`));
  assert.ok(args.includes('--unshare-net') && args.includes('--die-with-parent'));
  assert.deepEqual(args.slice(-4), ['--', 'bash', '-c', 'ls']);
  const [mac, macArgs] = sandbox.wrap('bash', ['-c', 'ls'], [project], { platform: 'darwin', network: true, tool: 'sandbox-exec' });
  assert.equal(mac, '/usr/bin/sandbox-exec');
  assert.match(macArgs[1], /\(deny file-write\*\)\(allow file-write\* \(subpath "[^"]+"\)/);
  assert.ok(macArgs[1].includes(JSON.stringify(realProject)));
  assert.doesNotMatch(macArgs[1], /deny network/);
  assert.throws(() => sandbox.wrap('bash', [], [project], { platform: 'win32', tool: null }), /turn the sandbox off/);
});

test("with the sandbox on, the agent's commands run in it, or not at all; the user's own commands don't", { timeout: 60000 }, async t => {
  fs.writeFileSync(settings, JSON.stringify({ sandbox: true }));
  const session = { name: 'p', state: { dirs: [] } };
  const outside = path.join(os.homedir(), `nexus-sandbox-escape-${process.pid}.txt`);
  try {
    if (!sandbox.available()) {
      await assert.rejects(async () => execTool('Bash', { command: 'echo hi' }, { cwd: project, session }), /turn the sandbox off/);
      assert.match(await execTool('Bash', { command: 'echo mine' }, { cwd: project, session, direct: true }), /mine/, 'your own commands still run');
      return t.skip(`no sandbox on ${process.platform}`);
    }
    // bubblewrap can be installed yet blocked (no user namespaces), which isn't Nexus's to fix.
    if (process.platform === 'linux' && spawnSync('bwrap', ['--ro-bind', '/', '/', 'true']).status !== 0) return t.skip('bwrap cannot run here');
    const out = await execTool('Bash', { command: `echo inside > inside.txt && cat inside.txt; echo outside > ${JSON.stringify(outside)}; echo done` }, { cwd: project, session });
    assert.match(out, /inside[\s\S]*done/);
    assert.equal(fs.readFileSync(path.join(project, 'inside.txt'), 'utf8').trim(), 'inside');
    assert.ok(!fs.existsSync(outside), 'nothing written outside the project');
  } finally {
    fs.rmSync(outside, { force: true });
    fs.writeFileSync(settings, '{}');
  }
});
