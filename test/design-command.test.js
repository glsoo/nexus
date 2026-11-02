import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-design-command-'));
process.env.HOME = tmp;
process.env.NEXUS_HOME = path.join(tmp, 'home');
process.env.NEXUS_PROJECTS = path.join(tmp, 'projects');
const projects = await import('../server/projects.js');
const { getSession, submit } = await import('../server/agent.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('/design without arguments and help aliases show usage without a model request', async () => {
  projects.create('design-help');
  const s = getSession('design-help');
  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected model request'); };
  try {
    for (const command of ['/design', '/design help', '/design --help', '/design -h']) {
      await submit(s.name, command);
      const entry = s.state.log.at(-1);
      assert.equal(entry.type, 'system');
      assert.match(entry.text, /Usage: `\/design \[build\|improve\|review\|logo\] <request>`/);
      assert.match(entry.text, /\/design improve the mobile chat composer/);
      assert.equal(s.running, false);
      assert.equal(s.queue.length, 0);
    }
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('/design forwards modes, plain requests and multiline briefs without losing arguments', async () => {
  projects.create('design-arguments');
  const s = getSession('design-arguments');
  // Leave prompts queued so this test checks dispatch, not a live model's interpretation.
  s.running = true;
  try {
    for (const arg of [
      'build a project dashboard',
      'improve the mobile chat composer',
      'review public/style.css for accessibility',
      'logo a purple N on black',
      'make the message box more compact',
      'improve public/style.css\nKeep the background black and use purple accents.',
    ]) {
      await submit(s.name, `/design ${arg}`);
      const queued = s.queue.at(-1);
      assert.ok(queued.text.endsWith(`Arguments: ${arg}`));
      assert.match(queued.text, /Use the "design" skill/);
      assert.match(queued.text, /Do not edit or deploy in review mode/);
      assert.equal(queued.entry.text, `/design ${arg}`);
    }
    assert.equal(s.queue.length, 6);
  } finally {
    s.queue.length = 0;
    s.running = false;
  }
});

test('skills without argument hints still run without arguments', async () => {
  const dir = path.join(process.env.NEXUS_HOME, 'skills/legacy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: legacy\ndescription: Legacy skill\n---\nRun the existing task.');
  projects.create('legacy-command');
  const s = getSession('legacy-command');
  s.running = true;
  try {
    await submit(s.name, '/legacy');
    assert.equal(s.queue.length, 1);
    assert.ok(s.queue[0].text.endsWith('Arguments: (none)'));
  } finally {
    s.queue.length = 0;
    s.running = false;
  }
});
