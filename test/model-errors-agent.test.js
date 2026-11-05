import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-model-errors-'));
process.env.NEXUS_PROJECTS = path.join(tmp, 'projects');
process.env.NEXUS_HOME = path.join(tmp, 'home');
process.env.NEXUS_MODEL = 'gpt-fixture';
for (const key of ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'DASHSCOPE_API_KEY']) delete process.env[key];
process.env.OPENAI_API_KEY = 'fixture-opaque-api-token';
const projects = await import('../server/projects.js');
const agent = await import('../server/agent.js');
fs.mkdirSync(process.env.NEXUS_HOME, { recursive: true });
const settings = path.join(process.env.NEXUS_HOME, 'settings.json');
fs.writeFileSync(settings, '{}');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const create = name => { projects.create(name); const s = agent.getSession(name); agent.setOption(s, 'model', 'gpt-fixture'); agent.setOption(s, 'mode', 'bypass'); return s; };
const wait = async (check, message) => {
  const end = Date.now() + 10000;
  while (!check() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(check(), message);
};
const idle = s => wait(() => !s.running && !s.queue.length, 'the fixture turn finished');
const sse = (...events) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'x-request-id': 'req-stream-fixture' } });
const ok = () => sse({ type: 'response.output_text.delta', item_id: 'fixture-answer', delta: 'All done.' }, { type: 'response.completed', response: { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'All done.' }] }], usage: { input_tokens: 1, output_tokens: 1 } } });
const failure = message => Response.json({ status: 'failed', error: { message, code: 'fixture_model_error', type: 'invalid_request_error', param: 'model' }, output: [] }, { headers: { 'x-request-id': 'req-json-fixture' } });
function mock(fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://openrouter.ai/api/v1/models') return Response.json({ data: [] });
    assert.equal(String(url), 'https://api.openai.com/v1/responses', 'no external request is allowed');
    return fn(JSON.parse(init.body));
  };
  return () => { globalThis.fetch = real; };
}

test('chat failures retain provider code, type and request ID without persisting the API key', async () => {
  const s = create('stream-failure');
  const restore = mock(() => sse({ type: 'error', error: { message: 'Model is unavailable for fixture-opaque-api-token', code: 'fixture_model_error', type: 'invalid_request_error', param: 'model' } }));
  try {
    await agent.submit(s.name, 'try the model');
    await idle(s);
    const error = s.state.log.at(-1);
    assert.equal(error.type, 'error');
    for (const value of ['OpenAI', 'Model is unavailable', 'fixture_model_error', 'invalid_request_error', 'req-stream-fixture']) assert.ok(error.text.includes(value), value);
    assert.ok(!JSON.stringify(s.state.log).includes('fixture-opaque-api-token'), 'request credentials are never logged');
  } finally { restore(); }
});

test('AI helper actions reject HTTP 200 failure envelopes instead of silently returning the draft', async () => {
  const s = create('helper-failure');
  const restore = mock(() => failure('Fixture enhancer failed'));
  try {
    await assert.rejects(agent.enhancePrompt(s.name, 'fix the parser'), err => err.message.includes('Fixture enhancer failed') && err.message.includes('req-json-fixture'));
  } finally { restore(); }
});

test('failed subagents retain the diagnostic in both the result and their saved log', async () => {
  const s = create('sub-failure');
  const restore = mock(() => sse({ type: 'error', error: { message: 'Fixture subagent model failed', code: 'fixture_model_error', type: 'invalid_request_error' } }));
  try {
    const result = await agent.runSubagent(s, { description: 'Fixture diagnostic subagent', prompt: 'Do nothing.', subagent_type: 'general-purpose' }, new AbortController().signal);
    assert.match(result, /Subagent failed:[\s\S]*Fixture subagent model failed/);
    assert.match(result, /fixture_model_error/);
    const child = agent.listAgents().find(a => a.project === s.name);
    assert.equal(child.status, 'failed');
    const saved = agent.getAgent(child.id);
    assert.equal(saved.log.at(-1).type, 'error');
    assert.match(saved.log.at(-1).text, /req-stream-fixture/);
  } finally { restore(); }
});

test('chat naming falls back but records the actual AI failure', async () => {
  const s = create('untitled');
  const restore = mock(() => failure('Fixture naming service failed'));
  try {
    await agent.autoName(s, 'sort the records');
    assert.equal(s.name, 'sort-the-records');
    assert.ok(s.state.log.some(e => /chat name[\s\S]*Fixture naming service failed/i.test(e.text)), 'the naming failure is visible');
  } finally { restore(); }
});

test('a failed AI risk rating is visible while the existing deterministic rules remain in force', async () => {
  const s = create('risk-failure');
  let turns = 0;
  const restore = mock(body => {
    if (!body.stream) return failure('Fixture risk service failed');
    if (++turns === 1) return sse({ type: 'response.completed', response: { output: [{ type: 'function_call', call_id: 'write-ci', name: 'Write', arguments: JSON.stringify({ file_path: '.github/workflows/fixture.yml', content: 'fixture: true\n' }) }], usage: { input_tokens: 1, output_tokens: 1 } } });
    return ok();
  });
  try {
    await agent.submit(s.name, 'write the fixture workflow');
    await idle(s);
    assert.ok(s.state.log.some(e => /risk[\s\S]*Fixture risk service failed/i.test(e.text)), 'the rating failure is visible');
    assert.equal(fs.readFileSync(path.join(projects.projectDir(s.name), '.github/workflows/fixture.yml'), 'utf8'), 'fixture: true\n');
  } finally { restore(); }
});

test('suggested-reply failure keeps the successful reply and shows the actual optional-request error', async () => {
  const s = create('suggestion-failure');
  fs.writeFileSync(settings, JSON.stringify({ suggestReplies: true }));
  const restore = mock(body => body.stream ? ok() : failure('Fixture suggestions failed'));
  try {
    await agent.submit(s.name, 'do the fixture task');
    await idle(s);
    await wait(() => s.state.log.some(e => /suggested replies[\s\S]*Fixture suggestions failed/i.test(e.text)), 'the suggestions failure is visible');
    assert.ok(s.state.log.some(e => e.type === 'assistant' && e.text === 'All done.'));
  } finally { restore(); fs.writeFileSync(settings, '{}'); }
});

test('incomplete or empty AI helpers report the reason instead of silently returning the draft', async () => {
  const s = create('incomplete-helper');
  let response = { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] };
  const restore = mock(() => Response.json(response, { headers: { 'x-request-id': 'incomplete-helper' } }));
  try {
    await assert.rejects(agent.enhancePrompt(s.name, 'original draft'), /content_filter[\s\S]*incomplete-helper/);
    response = { status: 'completed', output: [] };
    await assert.rejects(agent.enhancePrompt(s.name, 'original draft'), /no text/i);
  } finally { restore(); }
  const real = globalThis.fetch;
  fs.writeFileSync(settings, JSON.stringify({ providers: { helper: { name: 'Fixture helper', baseURL: 'https://helper.test/v1' } } }));
  agent.setOption(s, 'model', 'helper:fixture');
  globalThis.fetch = async url => {
    assert.equal(String(url), 'https://helper.test/v1/chat/completions');
    return sse({ choices: [{ delta: {}, finish_reason: 'content_filter' }] });
  };
  try {
    await assert.rejects(agent.enhancePrompt(s.name, 'original draft'), /content_filter/);
  } finally { globalThis.fetch = real; fs.writeFileSync(settings, '{}'); }
});

test('unexpected OpenAI stop reasons cannot persist echoed request credentials', async () => {
  const s = create('unexpected-stop');
  const restore = mock(() => sse({ type: 'response.incomplete', response: { output: [], incomplete_details: { reason: 'fixture-opaque-api-token' } } }));
  try {
    await agent.submit(s.name, 'try the fixture');
    await idle(s);
    const error = s.state.log.at(-1);
    assert.equal(error.type, 'error');
    assert.match(error.text, /Unexpected incomplete response reason[\s\S]*req-stream-fixture/);
    assert.ok(!JSON.stringify(s.state.log).includes('fixture-opaque-api-token'));
  } finally { restore(); }
});

test('late suggestion failures cannot add entries to a cleared conversation', async () => {
  const s = create('cleared-suggestion');
  fs.writeFileSync(settings, JSON.stringify({ suggestReplies: true }));
  let release;
  const restore = mock(body => body.stream ? ok() : new Promise(resolve => { release = () => resolve(failure('stale suggestion failure')); }));
  try {
    await agent.submit(s.name, 'do the fixture task');
    await idle(s);
    await wait(() => Boolean(release), 'the optional suggestion request started');
    await agent.submit(s.name, '/clear');
    const cleared = JSON.stringify(s.state.log);
    release();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(JSON.stringify(s.state.log), cleared, 'the old request must not write into the new generation');
  } finally { release?.(); restore(); fs.writeFileSync(settings, '{}'); }
});
