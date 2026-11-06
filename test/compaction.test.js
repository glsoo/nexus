import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-compaction-'));
process.env.NEXUS_PROJECTS = path.join(tmp, 'projects');
process.env.NEXUS_HOME = path.join(tmp, 'home');
process.env.NEXUS_MODEL = 'gpt-fixture';
for (const key of ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'DASHSCOPE_API_KEY']) delete process.env[key];
process.env.OPENAI_API_KEY = 'fixture-compaction-key';
const projects = await import('../server/projects.js');
const agent = await import('../server/agent.js');
fs.mkdirSync(process.env.NEXUS_HOME, { recursive: true });
fs.writeFileSync(path.join(process.env.NEXUS_HOME, 'settings.json'), '{}');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
const done = (text = 'A complete summary.', extra = {}) => new Response(`data: ${JSON.stringify({ type: extra.incomplete ? 'response.incomplete' : 'response.completed', response: { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 10, output_tokens: 3 }, ...(extra.incomplete ? { incomplete_details: { reason: extra.incomplete } } : {}), ...extra } })}\n\n`);
const create = (name, items = [{ role: 'user', content: 'Keep the original requirements.' }]) => {
  projects.create(name);
  const s = agent.getSession(name);
  agent.setOption(s, 'model', 'gpt-fixture');
  s.state.items = items;
  Object.assign(s.state.usage, { lastInput: 1234, lastCached: 321 });
  projects.save(name, s.state);
  return s;
};
const source = s => ({ items: structuredClone(s.state.items), gen: s.state.gen, lastInput: s.state.usage.lastInput, lastCached: s.state.usage.lastCached });
const unchanged = (s, before) => assert.deepEqual(source(s), before, 'original model history, generation and context counters must survive');
const wait = async check => { const end = Date.now() + 10000; while (!check() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20)); assert.ok(check(), 'fixture reached its expected stage'); };
function mock(reply, prices = () => Response.json({ data: [] })) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://openrouter.ai/api/v1/models') return prices();
    assert.equal(String(url), 'https://api.openai.com/v1/responses', 'no external model calls');
    return reply(JSON.parse(init.body), init);
  };
  return () => { globalThis.fetch = original; };
}

// Run first so the price cache has not warmed: cancellation after generation must still prevent publication.
test('stopping while summary pricing finishes cannot replace the conversation', async () => {
  const s = create('abort-after-summary'), before = source(s);
  s.controller = new AbortController();
  let release;
  const restore = mock(() => done(), () => new Promise(resolve => { release = () => resolve(Response.json({ data: [] })); }));
  try {
    const rejected = assert.rejects(agent.compact(s), { name: 'AbortError' });
    await wait(() => Boolean(release));
    s.controller.abort();
    release();
    await rejected;
    unchanged(s, before);
  } finally { release?.(); restore(); s.controller = null; }
});

test('long histories recover from context overflow without replaying an equally oversized summary forever', async () => {
  const s = create('oversized', [{ role: 'user', content: 'Keep requirement A.' }, { type: 'function_call', call_id: 'read-one', name: 'Read', arguments: '{"file_path":"large.txt"}' }, { type: 'function_call_output', call_id: 'read-one', output: 'important tool text\n'.repeat(4000) }, { role: 'user', content: 'Keep requirement B.' }]);
  const before = source(s), requests = [];
  const restore = mock(body => {
    requests.push(body);
    if (JSON.stringify(body.input).length > 12000) return Response.json({ error: { code: 'context_length_exceeded', message: 'Fixture context window exceeded' } }, { status: 400 });
    return done('Both requirements and the tool result were summarized.');
  });
  try {
    await agent.compact(s);
    assert.ok(requests.length > 2, 'recovery used smaller requests');
    assert.equal(s.state.gen, before.gen + 1);
    assert.equal(s.state.items.length, 1);
    assert.match(s.state.items[0].content, /Both requirements/);
    assert.ok(requests.slice(1).some(body => !body.tools?.length), 'recovery does not spend context on execution tools');
    const history = path.join(projects.projectDir(s.name), '.nexus', 'history');
    const archives = fs.readdirSync(history).map(name => JSON.parse(fs.readFileSync(path.join(history, name), 'utf8')));
    assert.ok(archives.some(saved => JSON.stringify(saved.items) === JSON.stringify(before.items)), 'exact source items remain recoverable');
  } finally { restore(); }
});

test('incomplete, empty, refused or tool-only summaries never erase history', async () => {
  for (const [name, response] of [
    ['truncated', () => done('Only part.', { incomplete: 'max_output_tokens' })],
    ['missing-reason', () => done('Only part.', { incomplete: true, incomplete_details: null })],
    ['failed-final-state', () => done('Only part.', { status: 'failed' })],
    ['empty', () => done('  ')],
    ['refused', () => done('', { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Cannot summarize.' }] }] })],
    ['tool-only', () => done('', { output: [{ type: 'function_call', call_id: 'unexpected', name: 'Read', arguments: '{}' }] })],
  ]) {
    const s = create(name), before = source(s);
    const restore = mock(response);
    try {
      await assert.rejects(agent.compact(s));
      unchanged(s, before);
      assert.notEqual(s.state.log.at(-1).text, 'Conversation compacted.');
      assert.deepEqual(projects.load(s.name).items, before.items);
    } finally { restore(); }
  }
});

test('summary publication failure keeps the original in-memory conversation', async () => {
  const s = create('save-failure'), before = source(s);
  const file = path.join(projects.projectDir(s.name), '.nexus', 'conversation.json'), backup = `${file}.fixture-backup`;
  const restore = mock(() => done());
  fs.renameSync(file, backup);
  fs.mkdirSync(file);
  try {
    await assert.rejects(agent.compact(s));
    unchanged(s, before);
  } finally {
    fs.rmSync(file, { recursive: true, force: true });
    fs.renameSync(backup, file);
    restore();
  }
});

test('interrupting manual compaction retains queued prompts without running them', async () => {
  const s = create('queued-interrupt'), before = source(s);
  let release, requests = 0;
  const restore = mock(() => {
    requests++;
    return requests === 1 ? new Promise(resolve => { release = () => resolve(done()); }) : done('Queued work should not run after Stop.');
  });
  try {
    const compacting = agent.submit(s.name, '/compact');
    await wait(() => Boolean(release));
    await agent.submit(s.name, 'Keep this queued request.');
    agent.interrupt(s.name);
    release();
    await compacting;
    assert.equal(s.running, false);
    assert.equal(requests, 1, 'Stop does not start queued work');
    assert.equal(s.state.gen, before.gen);
    assert.deepEqual(s.state.items.slice(0, before.items.length), before.items);
    assert.equal(s.state.items.at(-1).content, 'Keep this queued request.');
    assert.equal(s.queue.length, 0, 'the queued prompt was saved to model history');
  } finally {
    release?.();
    agent.interrupt(s.name);
    await wait(() => !s.running && !s.queue.length);
    restore();
  }
});

test('later-batch failure cannot commit a partial rolling summary', async () => {
  const s = create('late-batch', [{ role: 'user', content: 'Preserve this text. '.repeat(4000) }]), before = source(s);
  let accepted = 0;
  const restore = mock(body => {
    if (JSON.stringify(body.input).length > 12000) return Response.json({ error: { code: 'context_length_exceeded', message: 'Fixture too long' } }, { status: 400 });
    if (++accepted === 1) return done('Only the first batch is summarized.');
    return Response.json({ error: { message: 'Fixture second batch denied' } }, { status: 403 });
  });
  try {
    await assert.rejects(agent.compact(s), /Fixture second batch denied/);
    assert.equal(accepted, 2);
    unchanged(s, before);
    assert.deepEqual(projects.load(s.name).items, before.items);
  } finally { restore(); }
});

test('queued prompts survive successful and failed manual compaction exactly once', async () => {
  for (const success of [true, false]) {
    const s = create(`queue-${success}`), before = source(s);
    let release, requests = 0;
    const restore = mock(() => ++requests === 1 ? new Promise(resolve => { release = () => resolve(success ? done() : Response.json({ error: 'Fixture summary denied' }, { status: 403 })); }) : done('Queued request completed.'));
    try {
      const compacting = agent.submit(s.name, '/compact');
      await wait(() => Boolean(release));
      await agent.submit(s.name, 'A queued requirement.');
      release();
      await compacting;
      await wait(() => !s.running && !s.queue.length);
      assert.equal(requests, 2);
      assert.equal(s.state.gen, before.gen + Number(success));
      assert.equal(s.state.items.filter(item => item.role === 'user' && item.content === 'A queued requirement.').length, 1);
      if (!success) assert.deepEqual(s.state.items.slice(0, before.items.length), before.items);
    } finally { release?.(); agent.interrupt(s.name); await wait(() => !s.running && !s.queue.length); restore(); }
  }
});

test('sibling compaction archives its own exact items and gives the hook the right state file', async () => {
  projects.create('siblings');
  const key = projects.createChat('siblings', { model: 'gpt-fixture', items: [{ role: 'user', content: 'Sibling requirements.' }] });
  const s = agent.getSession(key), before = source(s), cwd = projects.projectDir(key);
  const settings = path.join(process.env.NEXUS_HOME, 'settings.json');
  const hook = path.join(cwd, 'fixture-hook.cjs');
  fs.writeFileSync(hook, "let text=''; process.stdin.on('data', chunk => text += chunk); process.stdin.on('end', () => require('node:fs').writeFileSync('hook-path.txt', JSON.parse(text).transcript));");
  fs.writeFileSync(settings, JSON.stringify({ hooks: { PreCompact: [{ command: 'node fixture-hook.cjs' }] } }));
  const restore = mock(() => done());
  try {
    await agent.compact(s);
    assert.equal(fs.readFileSync(path.join(cwd, 'hook-path.txt'), 'utf8'), projects.stateFile(key));
    assert.deepEqual(projects.load('siblings').items, []);
    const history = path.join(cwd, '.nexus', 'history');
    const archives = fs.readdirSync(history);
    assert.ok(archives.some(name => name.startsWith(`${projects.chatOf(key)}-compact_`)));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(history, archives[0]), 'utf8')).items, before.items);
    const compacted = source(s);
    fs.writeFileSync(hook, "process.stderr.write('Fixture archive hook refused'); process.exit(2);");
    await assert.rejects(agent.compact(s), /Fixture archive hook refused/);
    unchanged(s, compacted);
  } finally { restore(); fs.writeFileSync(settings, '{}'); }
});

test('a redirected archive folder cannot write private history into ordinary project files', async () => {
  const s = create('archive-redirect'), before = source(s), cwd = projects.projectDir(s.name);
  const destination = path.join(cwd, 'ordinary-files'), link = path.join(cwd, '.nexus', 'history');
  fs.mkdirSync(destination);
  fs.symlinkSync(destination, link, process.platform === 'win32' ? 'junction' : 'dir');
  const restore = mock(() => done());
  try {
    await assert.rejects(agent.compact(s), /archive|symbolic|redirect/i);
    unchanged(s, before);
    assert.deepEqual(fs.readdirSync(destination), []);
  } finally { fs.unlinkSync(link); restore(); }
});

test('automatic overflow compaction continues the request with the completed summary', async () => {
  const s = create('auto-overflow', [{ role: 'user', content: 'Original long requirements. '.repeat(2000) }]);
  let mainRequests = 0;
  const restore = mock(body => {
    if (!body.tool_choice) mainRequests++;
    if (JSON.stringify(body.input).length > 12000) return Response.json({ error: { code: 'context_length_exceeded', message: 'Fixture context overflow' } }, { status: 400 });
    return done(body.tool_choice ? 'Recovered complete summary.' : 'The request continued.');
  });
  try {
    await agent.submit(s.name, 'Continue from the original requirements.');
    await wait(() => !s.running && !s.queue.length);
    assert.equal(mainRequests, 2);
    assert.equal(s.state.gen, 1);
    assert.match(s.state.items[0].content, /Recovered complete summary/);
    assert.ok(s.state.items.some(item => item.type === 'message' && item.content.some(c => c.text === 'The request continued.')));
  } finally { agent.interrupt(s.name); await wait(() => !s.running && !s.queue.length); restore(); }
});
