import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execTool } from '../server/tools.js';

const cwd = path.join(os.tmpdir(), 'nexus-screenshot-validation');

for (const installed of [false, true]) {
  test(`Screenshot rejects network paths before browser discovery (${installed ? 'installed' : 'missing'} browser)`, async t => {
    const exists = t.mock.method(fs, 'existsSync', () => installed);
    for (const url of ['\\\\evil\\share\\x.html', '//evil/share/x.html']) {
      await assert.rejects(execTool('Screenshot', { url }, { cwd }), /Network paths are not supported/);
    }
    assert.equal(exists.mock.callCount(), 0, 'unsafe input is rejected before checking browser installation');
  });
}

test('Screenshot still reports a missing browser for supported page targets', async t => {
  const exists = t.mock.method(fs, 'existsSync', () => false);
  for (const url of ['http://localhost:5173/', 'page.html']) {
    await assert.rejects(execTool('Screenshot', { url }, { cwd }), /Screenshot needs Chrome, Edge or Chromium installed/);
  }
  assert.ok(exists.mock.callCount() > 0, 'supported input reaches browser discovery');
});
