import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-gemini-tools-'));
process.env.HOME = path.join(tmp, 'home');
process.env.NEXUS_HOME = path.join(process.env.HOME, 'nexus');
process.env.NEXUS_PROJECTS = path.join(tmp, 'projects');
process.env.XDG_CONFIG_HOME = path.join(process.env.HOME, 'config');
process.env.NEXUS_MODEL = 'gemini:gemini-3-flash-preview';
delete process.env.NEXUS_COMPAT;
for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY', 'XAI_API_KEY']) delete process.env[key];
fs.mkdirSync(process.env.HOME, { recursive: true });

// No request, including model catalogs, may fall through to the real network.
const networkFetch = globalThis.fetch;
globalThis.fetch = async url => { throw new Error(`Unexpected fetch in Gemini integration tests: ${url}`); };
const projects = await import('../server/projects.js');
const agent = await import('../server/agent.js');
test.after(() => {
  globalThis.fetch = networkFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const FIRST_SIGNATURE = 'CiQAAAB+/w==|雪🧠|e\u0301|+/==';
const NEXT_SIGNATURE = 'EioBCgAB+/9=|別🔒|é|/w==';
const firstExtra = { google: { thought_signature: FIRST_SIGNATURE } };
const nextExtra = { google: { thought_signature: NEXT_SIGNATURE } };
const skipExtra = { google: { thought_signature: 'skip_thought_signature_validator' } };
const providers = [
  { id: 'gemini', model: 'gemini:gemini-3-flash-preview', base: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'openrouter', model: 'openrouter:google/gemini-3-flash-preview', base: 'https://openrouter.ai/api/v1' },
];

const idle = async s => {
  for (let n = 0; n < 1000 && (s.running || s.queue.length); n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(s.running, false, 'the public submit loop finished');
  assert.equal(s.queue.length, 0, 'the prompt queue drained');
};
const delta = (tool_calls, finish_reason) => ({ choices: [{ delta: { tool_calls }, ...(finish_reason ? { finish_reason } : {}) }] });
const terminal = text => [{ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }];
function sse(events) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

// Like Gemini, reject malformed history with HTTP 400 rather than silently answering.
function fakeGemini(provider, respond) {
  const sent = [], accepted = [], rejected = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if ([`${provider.base}/models`, 'https://openrouter.ai/api/v1/models'].includes(String(url))) return Response.json({ data: [] });
    assert.equal(String(url), `${provider.base}/chat/completions`, 'only the mocked provider can receive a model request');
    const body = JSON.parse(init.body);
    sent.push(body);
    try {
      assert.equal(body.model, provider.model.slice(provider.id.length + 1));
      assert.equal(body.stream, true);
      const events = respond(body, sent.length);
      accepted.push(body);
      return sse(events);
    } catch (err) {
      rejected.push(err.message);
      return Response.json({ error: { message: `Invalid thought signature or tool history: ${err.message}` } }, { status: 400 });
    }
  };
  return { sent, accepted, rejected, restore: () => { globalThis.fetch = previousFetch; } };
}

function assertHistory(body, cwd, sequential = false) {
  const history = body.messages.slice(2, sequential ? 7 : 5);
  assert.deepEqual(history.map(m => m.role), sequential ? ['assistant', 'tool', 'tool', 'assistant', 'tool'] : ['assistant', 'tool', 'tool']);
  assert.deepEqual(history[0].tool_calls, [
    { id: 'parallel-glob', type: 'function', function: { name: 'Glob', arguments: '{"pattern":"*.txt"}' }, extra_content: firstExtra },
    { id: 'parallel-read', type: 'function', function: { name: 'Read', arguments: '{"file_path":"note.txt"}' } },
  ], 'the signed first call and unsigned parallel sibling retain their index order');
  assert.deepEqual(history.slice(1, 3), [
    { role: 'tool', tool_call_id: 'parallel-glob', content: path.join(cwd, 'note.txt') },
    { role: 'tool', tool_call_id: 'parallel-read', content: '     1\tfixture note' },
  ], 'actual parallel tool results stay paired with the original call ids');
  if (sequential) {
    assert.deepEqual(history[3].tool_calls, [
      { id: 'sequential-read', type: 'function', function: { name: 'Read', arguments: '{"file_path":"detail.md"}' }, extra_content: nextExtra },
    ], 'a later assistant block keeps its own distinct signature');
    assert.deepEqual(history[4], { role: 'tool', tool_call_id: 'sequential-read', content: '     1\tfixture detail' });
  }
}

function assertPrivate(api, s, events = []) {
  const visible = JSON.stringify({ state: api.publicState(s), log: s.state.log, events });
  assert.equal(Object.hasOwn(api.publicState(s), 'items'), false);
  assert.doesNotMatch(visible, /thought_signature|extra_content/);
  assert.equal(visible.includes(FIRST_SIGNATURE), false);
  assert.equal(visible.includes(NEXT_SIGNATURE), false);
}

for (const provider of providers) {
  test(`${provider.id}: public submit preserves late streamed signatures through parallel tools, sequential tools and a JSON reload`, async () => {
    const name = `signed-${provider.id}`;
    projects.create(name);
    const cwd = projects.projectDir(name);
    fs.writeFileSync(path.join(cwd, 'note.txt'), 'fixture note');
    fs.writeFileSync(path.join(cwd, 'detail.md'), 'fixture detail');
    const s = agent.getSession(name);
    agent.setOption(s, 'model', provider.model);
    const events = [];
    const listen = (project, event) => { if (project === name) events.push(JSON.parse(JSON.stringify(event))); };
    agent.hub.on('project', listen);
    const model = fakeGemini(provider, (body, n) => {
      if (n === 1) {
        assert.deepEqual(body.messages.map(m => m.role), ['system', 'user']);
        assert.ok(body.tools.some(t => t.function.name === 'Glob'));
        assert.ok(body.tools.some(t => t.function.name === 'Read'));
        return [
          // Index 1 arrives first; argument fragments for both calls are interleaved.
          delta([{ index: 1, id: 'parallel-read', type: 'function', function: { name: 'Read', arguments: '{"file_' } }]),
          delta([{ index: 0, id: 'parallel-glob', type: 'function', function: { name: 'Glob', arguments: '{"pat' } }]),
          delta([{ index: 1, function: { arguments: 'path":"note.txt"}' } }, { index: 0, function: { arguments: 'tern":"*.txt"}' } }]),
          // Gemini can send only metadata in a later chunk, with no function member.
          delta([{ index: 0, extra_content: firstExtra }], 'tool_calls'),
        ];
      }
      assertHistory(body, cwd, n >= 3);
      if (n === 2) return [
        delta([{ index: 0, id: 'sequential-read', type: 'function', function: { name: 'Read', arguments: '{"file_path":' } }]),
        delta([{ index: 0, function: { arguments: '"detail.md"}' } }]),
        delta([{ index: 0, extra_content: nextExtra }], 'tool_calls'),
      ];
      if (n === 3) return terminal('All fixture tools finished.');
      assert.equal(n, 4, 'only one additional request follows the restart');
      assert.equal(body.messages.at(-2).content, 'All fixture tools finished.');
      assert.equal(body.messages.at(-1).content, 'Continue after restart.');
      return terminal('Saved signatures still work.');
    });
    try {
      await agent.submit(name, 'Inspect the fixture files.');
      await idle(s);
      assert.deepEqual(model.rejected, [], 'the mocked Gemini validator accepted every follow-up');
      assert.equal(model.sent.length, 3);
      assert.equal(model.accepted.length, 3);
      assert.equal(s.state.usage.requests, 3);
      assert.deepEqual(s.state.log.filter(e => e.type === 'error' || e.status === 'error'), []);
      assert.deepEqual(s.state.log.filter(e => e.type === 'tool').map(e => [e.name, e.status, e.output]), [
        ['Glob', 'done', path.join(cwd, 'note.txt')], ['Read', 'done', '     1\tfixture note'], ['Read', 'done', '     1\tfixture detail'],
      ]);
      assert.equal(s.state.log.at(-1).text, 'All fixture tools finished.');
      const calls = s.state.items.filter(i => i.type === 'function_call');
      assert.deepEqual([calls[0].compat, calls[2].compat], [
        { model: provider.model, extra_content: firstExtra }, { model: provider.model, extra_content: nextExtra },
      ], 'both signed calls record their exact source model');
      if (provider.id === 'gemini') assert.deepEqual(calls[1].compat, { model: provider.model }, 'the unsigned Gemini sibling is marked as native, not imported');
      assertPrivate(agent, s, events);

      projects.save(name, s.state);
      const loaded = projects.load(name);
      assert.notEqual(loaded, s.state);
      assert.deepEqual(loaded, JSON.parse(JSON.stringify(s.state)), 'the saved conversation survives a real JSON disk roundtrip');
      // A fresh agent module has an empty session map, just like a restarted server.
      const restarted = await import(`../server/agent.js?gemini-tools-restart=${provider.id}`);
      const reloaded = restarted.getSession(name);
      assert.notEqual(reloaded, s);
      assert.deepEqual(reloaded.state.items, loaded.items);
      await restarted.submit(name, 'Continue after restart.');
      await idle(reloaded);
      assert.deepEqual(model.rejected, []);
      assert.equal(model.sent.length, 4);
      assert.equal(model.accepted.length, 4);
      assert.equal(reloaded.state.usage.requests, 4);
      assert.deepEqual(reloaded.state.log.filter(e => e.type === 'error' || e.status === 'error'), []);
      assert.equal(reloaded.state.log.at(-1).text, 'Saved signatures still work.');
      assert.deepEqual(reloaded.state.items.slice(0, loaded.items.length), loaded.items, 'continuing never clears or rewrites saved history');
      assertPrivate(restarted, reloaded);
    } finally {
      agent.hub.off('project', listen);
      model.restore();
    }
  });

  if (provider.id === 'gemini') test(`${provider.id}: a saved chat with lost or foreign signatures recovers without clearing history`, async () => {
    const name = `recovery-${provider.id}`;
    projects.create(name);
    const saved = projects.load(name);
    saved.model = provider.model;
    saved.items = [
      { role: 'user', content: 'An earlier task that must not disappear.' },
      { type: 'function_call', call_id: 'old-a', name: 'Glob', arguments: '{"pattern":"*.txt"}' },
      { type: 'function_call', call_id: 'old-b', name: 'Read', arguments: '{"file_path":"note.txt"}' },
      { type: 'function_call_output', call_id: 'old-a', output: 'saved glob output' },
      { type: 'function_call_output', call_id: 'old-b', output: 'saved read output' },
      { type: 'function_call', call_id: 'foreign', name: 'Read', arguments: '{"file_path":"detail.md"}', compat: { model: 'gemini:another-model', extra_content: { google: { thought_signature: 'foreign-signature-must-not-replay' } } } },
      { type: 'function_call', call_id: 'signed', name: 'Read', arguments: '{"file_path":"note.txt"}', compat: { model: provider.model, extra_content: nextExtra } },
      { type: 'function_call_output', call_id: 'foreign', output: 'saved detail output' },
      { type: 'function_call_output', call_id: 'signed', output: 'saved signed output' },
    ];
    saved.log.push({ id: 'old-error', type: 'error', text: 'Previous request failed because a thought signature was missing.' });
    projects.save(name, saved);
    const originalItems = JSON.parse(JSON.stringify(saved.items));
    const s = agent.getSession(name);
    const model = fakeGemini(provider, (body, n) => {
      assert.equal(n, 1, 'recovery does not need a failed request or a retry');
      assert.deepEqual(body.messages.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'tool', 'assistant', 'tool', 'tool', 'user']);
      assert.deepEqual(body.messages[2].tool_calls.map(c => [c.id, c.extra_content]), [['old-a', skipExtra], ['old-b', undefined]], 'only the first unsigned call in an imported parallel block gets the documented bypass');
      assert.deepEqual(body.messages[5].tool_calls.map(c => [c.id, c.extra_content]), [['foreign', skipExtra], ['signed', nextExtra]], 'a foreign model marker cannot replay its signature, and a real matching signature is never replaced');
      assert.deepEqual(body.messages.filter(m => m.role === 'tool').map(m => [m.tool_call_id, m.content]), [
        ['old-a', 'saved glob output'], ['old-b', 'saved read output'], ['foreign', 'saved detail output'], ['signed', 'saved signed output'],
      ]);
      assert.equal(body.messages.at(-1).content, 'Continue the existing chat.');
      assert.equal(JSON.stringify(body).includes('foreign-signature-must-not-replay'), false);
      return terminal('Recovered without clearing the chat.');
    });
    try {
      await agent.submit(name, 'Continue the existing chat.');
      await idle(s);
      assert.deepEqual(model.rejected, []);
      assert.equal(model.sent.length, 1);
      assert.equal(model.accepted.length, 1);
      assert.equal(s.state.usage.requests, 1);
      assert.deepEqual(s.state.items.slice(0, originalItems.length), originalItems, 'replay repair neither destroys history nor persists synthetic bypass signatures');
      assert.deepEqual(s.state.log.filter(e => e.type === 'error'), saved.log, 'the old error remains visible, but no new error was added');
      assert.equal(s.state.log.at(-1).text, 'Recovered without clearing the chat.');
      assertPrivate(agent, s);
      assert.deepEqual(projects.load(name).items.slice(0, originalItems.length), originalItems);
    } finally { model.restore(); }
  });
}
