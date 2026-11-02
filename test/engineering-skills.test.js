import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-engineering-skills-'));
process.env.HOME = tmp;
process.env.NEXUS_HOME = path.join(tmp, 'home');
process.env.NEXUS_PROJECTS = path.join(tmp, 'projects');
const projects = await import('../server/projects.js');
const { getSession, submit } = await import('../server/agent.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

for (const [name, request] of [
  ['debug', 'explain why login fails\nDo not change files.'],
  ['test', 'write regression tests for viewport sizing'],
  ['review', 'public/style.css for keyboard accessibility\nTrace focus handling in public/app.js too.\nKeep the review read-only.'],
  ['refactor', 'the composer without changing behavior'],
]) {
  test(`/${name} shows help without a model request and preserves the full brief`, async () => {
    projects.create(`${name}-commands`);
    const s = getSession(`${name}-commands`);
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error('Unexpected model request'); };
    try {
      for (const arg of ['', 'help', '--help', '-h']) {
        await submit(s.name, `/${name} ${arg}`.trim());
        const entry = s.state.log.at(-1);
        assert.equal(entry.type, 'system');
        assert.ok(entry.text.startsWith(`Usage: \`/${name} `));
        assert.ok(entry.text.includes(`/${name} `));
        assert.equal(s.running, false);
        assert.equal(s.queue.length, 0);
      }
      // Inspect the queued prompt without calling a live model or executing its task.
      s.running = true;
      await submit(s.name, `/${name} ${request}`);
      assert.equal(s.queue.length, 1);
      assert.ok(s.queue[0].text.startsWith(`Use the "${name}" skill`));
      assert.ok(s.queue[0].text.endsWith(`Arguments: ${request}`));
      assert.equal(s.queue[0].entry.text, `/${name} ${request}`);
      assert.equal(requests, 0);
    } finally {
      s.queue.length = 0;
      s.running = false;
      globalThis.fetch = originalFetch;
    }
  });
}
