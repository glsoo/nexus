import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-diagnose-'));
process.env.NEXUS_HOME = path.join(tmp, 'home');
fs.mkdirSync(process.env.NEXUS_HOME);
const { typeErrors } = await import('../server/diagnose.js');
const sandbox = await import('../server/sandbox.js');
const settings = path.join(process.env.NEXUS_HOME, 'settings.json');
const compiler = path.join(tmp, 'node_modules', 'typescript', 'bin', 'tsc');
fs.mkdirSync(path.dirname(compiler), { recursive: true });
fs.writeFileSync(path.join(tmp, 'tsconfig.json'), '{}');
fs.writeFileSync(settings, '{}');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('automatic TypeScript checks cannot run project code outside the sandbox', async () => {
  const outside = path.join(os.homedir(), `nexus-diagnose-escape-${process.pid}.txt`);
  fs.writeFileSync(compiler, `require('node:fs').writeFileSync(${JSON.stringify(outside)}, 'escaped');`);
  fs.writeFileSync(settings, JSON.stringify({ sandbox: true }));
  try {
    if (!sandbox.available()) await assert.rejects(typeErrors(tmp, [], undefined), /turn the sandbox off/);
    else {
      // An installed sandbox can itself be blocked; neither case may fall back to host execution.
      await typeErrors(tmp, [], undefined).catch(() => {});
    }
    assert.equal(fs.existsSync(outside), false, 'the compiler must never run unconfined');
  } finally {
    fs.rmSync(outside, { force: true });
    fs.writeFileSync(settings, '{}');
  }
});

test('automatic TypeScript checks keep diagnostics but not the server credentials', async () => {
  const keys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NEXUS_PASS_HASH'];
  const before = keys.map(key => process.env[key]);
  for (const key of keys) process.env[key] = 'fixture-do-not-inherit';
  fs.writeFileSync(compiler, `
    const leaked = ${JSON.stringify(keys)}.some(key => process.env[key]);
    console.log('src/changed.ts(1,1): error TS2322: ' + (leaked ? 'credentials leaked' : 'fixture error'));
    console.log('src/old.ts(1,1): error TS2304: old error');
    process.exit(2);
  `);
  try {
    const result = await typeErrors(tmp, ['src/changed.ts'], undefined);
    assert.equal(result.all.length, 2);
    assert.deepEqual(result.counted, ['src/changed.ts(1,1): error TS2322: fixture error']);
    const next = await typeErrors(tmp, [], result.seen);
    assert.equal(next.counted.length, 0);
  } finally {
    keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; });
  }
});

test('a compiler that fails without diagnostics is not reported as a successful type check', async () => {
  fs.writeFileSync(compiler, "console.error('fixture compiler could not start'); process.exit(1);");
  await assert.rejects(typeErrors(tmp, [], undefined), /fixture compiler could not start/);
});

test('a signal-terminated compiler does not count as a completed check with partial diagnostics', { skip: process.platform === 'win32' && 'Windows reports self-SIGTERM as an ordinary exit code' }, async () => {
  fs.writeFileSync(compiler, "console.log('old.ts(1,1): error TS2304: old error'); setTimeout(() => process.kill(process.pid, 'SIGTERM'), 50);");
  await assert.rejects(typeErrors(tmp, [], new Set(['old.ts: error TS2304: old error'])));
});

test('cancelling a compiler after diagnostics does not report a completed check', { timeout: 20000 }, async () => {
  const ready = path.join(tmp, 'compiler-ready');
  fs.writeFileSync(compiler, `
    const fs = require('node:fs');
    fs.writeSync(1, 'old.ts(1,1): error TS2304: old error\\n');
    fs.writeFileSync(${JSON.stringify(ready)}, 'ready');
    setInterval(() => {}, 1000);
  `);
  const controller = new AbortController();
  const rejected = assert.rejects(typeErrors(tmp, [], undefined, controller.signal), { name: 'AbortError' });
  try {
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(fs.existsSync(ready), 'the compiler emitted diagnostics before cancellation');
  } finally {
    controller.abort();
    await rejected;
  }
});

test('exceeding the compiler output limit does not count as a completed check', async () => {
  fs.writeFileSync(compiler, "console.log('old.ts(1,1): error TS2304: old error'); process.stdout.write(Buffer.alloc(21 * 1024 * 1024, 65));");
  await assert.rejects(typeErrors(tmp, [], undefined), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
});
