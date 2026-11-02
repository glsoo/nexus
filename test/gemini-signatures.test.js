import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-gemini-signatures-'));
process.env.HOME = tmp;
process.env.NEXUS_HOME = path.join(tmp, 'home');
process.env.NEXUS_PROJECTS = path.join(tmp, 'projects');
process.env.GEMINI_API_KEY = 'fixture-gemini-key';
const { callCompat, toMessages } = await import('../server/compat.js');
const { requestBody } = await import('../server/agent.js');
const { toMessages: anthropicMessages } = await import('../server/anthropic.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const model = 'gemini:gemini-fixture';
const signature = 'opaque/A+b==\nunchanged-λ';
const extra = { google: { thought_signature: signature, other: 'preserve' }, vendor: { trace: 'fixture' } };
const sink = () => ({ add: entry => entry, delta() {}, update() {} });
const tool = { type: 'function', name: 'Glob', description: 'Find files', parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } };
const params = input => ({ model, instructions: 'Test', input, tools: [tool] });
const user = { role: 'user', content: 'Find files.' };
const output = id => ({ type: 'function_call_output', call_id: id, output: 'fixture.txt' });
const callItem = (id, metadata) => ({ type: 'function_call', call_id: id, name: 'Glob', arguments: '{"pattern":"*"}', ...(metadata && { compat: metadata }) });
const event = (delta, finish_reason) => ({ choices: [{ delta, ...(finish_reason && { finish_reason }) }] });
const response = events => {
  const bytes = new TextEncoder().encode(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n');
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 17) controller.enqueue(bytes.slice(i, i + 17));
    controller.close();
  } }));
};
const completed = () => response([event({ content: 'Found fixture.txt.' }, 'stop')]);

// The first call's metadata can arrive after all its arguments, without a function field.
test('Gemini streamed tool signatures survive metadata-only chunks and the next request verbatim', async t => {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    sent.push(JSON.parse(init.body));
    if (sent.length === 1) return response([
      event({ tool_calls: [{ index: 0, id: 'glob-1', function: { name: 'Glob', arguments: '{"pat' } }] }),
      event({ tool_calls: [{ index: 0, function: { arguments: 'tern":"*"}' } }] }),
      event({ tool_calls: [{ index: 0, extra_content: extra }] }),
      event({ tool_calls: [{ index: 0, extra_content: { google: { later: true } } }] }, 'tool_calls'),
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ]);
    const call = sent[1].messages.find(m => m.tool_calls)?.tool_calls[0];
    if (call?.extra_content?.google?.thought_signature !== signature) {
      return Response.json({ error: { code: 400, message: 'Function call is missing a thought_signature in functionCall parts.' } }, { status: 400 });
    }
    return completed();
  });
  const first = await callCompat(params([user]), sink());
  const saved = JSON.parse(JSON.stringify(first.output));
  const expectedExtra = { ...extra, google: { ...extra.google, later: true } };
  assert.deepEqual(saved[0].compat, { model, extra_content: expectedExtra });
  assert.equal(saved[0].arguments, '{"pattern":"*"}');
  const next = await callCompat(params([user, ...saved, output('glob-1')]), sink());
  assert.equal(next.output[0].content[0].text, 'Found fixture.txt.');
  assert.deepEqual(sent[1].messages[2].tool_calls[0], {
    id: 'glob-1', type: 'function', function: { name: 'Glob', arguments: '{"pattern":"*"}' }, extra_content: expectedExtra,
  });
  assert.equal(first.usage.input_tokens, 10);
});

test('parallel calls keep a signature on its original call and all results follow the call group', () => {
  const items = [user, callItem('a', { model, extra_content: extra }), callItem('b', { model }), output('a'), output('b'), callItem('c', { model, extra_content: { google: { thought_signature: 'second-step' } } }), output('c')];
  const before = structuredClone(items);
  const messages = toMessages('sys', items, 'gemini', model);
  assert.deepEqual(messages.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'tool', 'assistant', 'tool']);
  assert.deepEqual(messages[2].tool_calls.map(c => c.id), ['a', 'b']);
  assert.deepEqual(messages[2].tool_calls[0].extra_content, extra);
  assert.equal(Object.hasOwn(messages[2].tool_calls[1], 'extra_content'), false, 'never copy the first signature onto parallel calls');
  assert.equal(messages[5].tool_calls[0].extra_content.google.thought_signature, 'second-step');
  assert.deepEqual(items, before);
});

test('old or imported unsigned history recovers only the first call per group without mutating saved history', () => {
  const items = [user, callItem('old-a'), callItem('old-b'), output('old-a'), output('old-b'), callItem('old-c'), output('old-c')];
  const before = structuredClone(items);
  const messages = toMessages('sys', items, 'gemini', model);
  for (const at of [2, 5]) assert.equal(messages[at].tool_calls[0].extra_content?.google?.thought_signature, 'skip_thought_signature_validator');
  assert.equal(Object.hasOwn(messages[2].tool_calls[1], 'extra_content'), false);
  assert.deepEqual(items, before, 'fallback must not replace or clear conversation history');
});

test('a new unsigned response is marked as such, not silently relabeled as legacy history', async t => {
  t.mock.method(globalThis, 'fetch', async () => response([event({ tool_calls: [{ index: 0, id: 'unsigned', function: { name: 'Glob', arguments: '{}' } }] }, 'tool_calls')]));
  const result = await callCompat(params([user]), sink());
  assert.deepEqual(result.output[0].compat, { model });
  const messages = toMessages('sys', [user, ...result.output, output('unsigned')], 'gemini', model);
  assert.equal(Object.hasOwn(messages[2].tool_calls[0], 'extra_content'), false);
});

test('compatible metadata does not leak across providers, models, or native APIs', () => {
  const items = [user, callItem('signed', { model, extra_content: extra }), output('signed')];
  const before = structuredClone(items);
  for (const [provider, target] of [['groq', 'groq:fixture'], ['openrouter', 'openrouter:google/fixture']]) {
    assert.equal(Object.hasOwn(toMessages('sys', items, provider, target)[2].tool_calls[0], 'extra_content'), false);
  }
  const changedModel = toMessages('sys', items, 'gemini', 'gemini:different-model');
  assert.equal(changedModel[2].tool_calls[0].extra_content.google.thought_signature, 'skip_thought_signature_validator', 'another model cannot reuse this model’s signature');
  const native = requestBody({ model: 'gpt-fixture', input: items, tools: [] });
  assert.deepEqual(native.input, items.map(({ compat, ...item }) => item));
  assert.equal(JSON.stringify(native).includes('compat'), false);
  assert.equal(JSON.stringify(native).includes('opaque/A+b'), false);
  const anthropic = anthropicMessages(items);
  assert.equal(JSON.stringify(anthropic).includes('compat'), false);
  assert.equal(JSON.stringify(anthropic).includes(signature), false);
  assert.deepEqual(items, before);
});

test('a signature on the first tool delta survives later argument fragments that omit metadata', async t => {
  t.mock.method(globalThis, 'fetch', async () => response([
    event({ content: 'Looking for files.', tool_calls: [{ index: 0, id: 'early', function: { name: 'Glob', arguments: '{\"pat' }, extra_content: extra }] }),
    event({ tool_calls: [{ index: 0, function: { arguments: 'tern\":\"*\"}' } }] }, 'tool_calls'),
  ]));
  const result = await callCompat(params([user]), sink());
  assert.deepEqual(result.output[1].compat, { model, extra_content: extra });
  const replay = toMessages('sys', [user, ...result.output, output('early')], 'gemini', model);
  assert.equal(replay[2].content, 'Looking for files.');
  assert.deepEqual(replay[2].tool_calls[0].extra_content, extra);
  assert.equal(replay[2].tool_calls[0].function.arguments, '{\"pattern\":\"*\"}');
});

// Optional vendor metadata is passed through if supplied; this does not assume
// Gemini's Chat Completions endpoint always emits message-level signatures.
for (const text of ['Found fixture.txt.', '']) {
  test(`optional assistant metadata survives empty final deltas (${text ? 'with text' : 'metadata only'})`, async t => {
    t.mock.method(globalThis, 'fetch', async () => response([
      event({ content: text }), event({ content: '', extra_content: extra }, 'stop'),
    ]));
    const result = await callCompat(params([user]), sink());
    assert.deepEqual(result.output[0].compat, { model, extra_content: extra });
    const history = [user, ...JSON.parse(JSON.stringify(result.output))];
    const replay = toMessages('sys', history, 'gemini', model);
    assert.equal(replay[2].content, text);
    assert.deepEqual(replay[2].extra_content, extra);
    assert.equal(Object.hasOwn(toMessages('sys', history, 'groq', 'groq:fixture')[2], 'extra_content'), false);
    assert.deepEqual(requestBody({ model: 'gpt-fixture', input: history, tools: [] }).input, history.map(({ compat, ...item }) => item));
  });
}

test('a truncated tool stream cannot return executable calls before its terminal metadata', async t => {
  t.mock.method(globalThis, 'fetch', async () => response([
    event({ tool_calls: [{ index: 0, id: 'cut-off', function: { name: 'Glob', arguments: '{"pattern":"*"}' } }] }),
  ]));
  await assert.rejects(callCompat(params([user]), sink()), /stream ended unexpectedly/i);
});
