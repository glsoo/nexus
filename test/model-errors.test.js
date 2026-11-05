import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-model-errors-'));
const savedEnv = { ...process.env };
process.env.NEXUS_HOME = tmp;
const keyNames = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY', 'XAI_API_KEY', 'DASHSCOPE_API_KEY'];
for (const name of keyNames) delete process.env[name];
const networkFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Unexpected external request in model error test'); };
const util = await import('../server/util.js');
const anthropic = await import('../server/anthropic.js');
const compat = await import('../server/compat.js');
test.after(() => {
  globalThis.fetch = networkFetch;
  for (const name of ['NEXUS_HOME', ...keyNames]) {
    if (savedEnv[name] === undefined) delete process.env[name]; else process.env[name] = savedEnv[name];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});
test.afterEach(() => {
  fs.rmSync(path.join(tmp, 'settings.json'), { force: true });
  for (const name of keyNames) delete process.env[name];
});
const settings = providers => fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({ providers }));
const params = model => ({ model, instructions: '', input: [], tools: [] });
const sink = () => ({ add: e => e, delta() {}, update() {} });
const sse = (events, headers = {}) => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers });
const rejected = async promise => {
  try { await promise; assert.fail('Expected provider error'); } catch (err) { if (err.code === 'ERR_ASSERTION') throw err; return err; }
};
const noSecrets = (err, values) => {
  const visible = `${err.message}\n${JSON.stringify(err)}\n${err.stack}`;
  for (const value of values) assert.equal(visible.includes(value), false, 'credential must not appear in diagnostics or error properties');
  assert.equal(err.cause, undefined, 'raw causes must not be retained');
};

test('HTTP errors preserve provider status, code, type, request ID and safe metadata', async t => {
  for (const status of [401, 403]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'Key rejected by this endpoint', code: 'invalid_api_key', type: 'authentication_error', param: 'model', location: 'header' } }, { status, headers: { 'x-request-id': 'request-fixture' } }));
    const err = await rejected(util.postWithRetry('Fixture', 'https://provider.test/v1', {}, {}));
    assert.match(err.message, new RegExp(`^Fixture ${status}: Key rejected`));
    assert.deepEqual([err.provider, err.status, err.code, err.type, err.requestId, err.param, err.location], ['Fixture', status, 'invalid_api_key', 'authentication_error', 'request-fixture', 'model', 'header']);
    assert.match(err.message, /invalid_api_key[\s\S]*authentication_error/);
    assert.match(err.message, /request-fixture/);
  }
});

test('Gemini semantic status and nested response error survive HTTP 400', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ response: { error: { code: 400, message: 'Invalid argument in contents', status: 'INVALID_ARGUMENT' }, request_id: 'body-request' } }, { status: 400 }));
  const err = await rejected(util.postWithRetry('Google Gemini', 'https://provider.test/v1', {}, {}));
  assert.deepEqual([err.status, err.code, err.providerStatus, err.requestId], [400, 400, 'INVALID_ARGUMENT', 'body-request']);
  assert.match(err.message, /INVALID_ARGUMENT/);
});

test('HTTP plain text and nonstandard error bodies retain diagnostics', async t => {
  for (const body of ['Proxy refused connection', '{"detail":"Proxy policy denied this model"}', '{"error":"Unknown model name"}']) {
    t.mock.method(globalThis, 'fetch', async () => new Response(body, { status: 403, headers: { 'request-id': 'proxy-request' } }));
    const err = await rejected(util.postWithRetry('Proxy', 'https://provider.test/v1', {}, {}));
    assert.match(err.message, /Proxy 403: (Proxy refused|Proxy policy|Unknown model)/);
    assert.equal(err.requestId, 'proxy-request');
  }
});

test('transport diagnostics preserve nested DNS, TLS and AggregateError children without raw causes', async t => {
  const dns = Object.assign(new Error('getaddrinfo ENOTFOUND provider.test'), { code: 'ENOTFOUND' });
  const tls = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed', { cause: new AggregateError([dns, tls], 'Multiple connections failed') }); });
  const err = await rejected(util.postWithRetry('Fixture', 'https://provider.test/v1', {}, {}));
  assert.match(err.message, /^Fixture: fetch failed/);
  for (const text of ['getaddrinfo ENOTFOUND', 'certificate has expired', 'CERT_HAS_EXPIRED', 'Multiple connections failed']) assert.ok(err.message.includes(text));
  assert.equal(err.code, 'ENOTFOUND');
  assert.equal(err.cause, undefined);
  assert.equal(err.errors, undefined);
});

test('modelFetch captures opaque credentials before awaiting and keeps them after key rotation', async t => {
  const original = 'opaque-supplied-credential-111';
  const rotated = 'opaque-replacement-222';
  const headers = new Headers({ authorization: `Bearer ${original}` });
  t.mock.method(globalThis, 'fetch', async () => {
    headers.set('authorization', `Bearer ${rotated}`);
    return new Response('');
  });
  const res = await util.modelFetch('Fixture', 'https://provider.test/v1', { headers });
  const err = util.modelError('Fixture', { error: { message: `Bad authorization: Bearer ${original}; echoed key ${original}`, code: original }, request_id: original }, res);
  noSecrets(err, [original]);
  assert.match(err.message, /\[REDACTED\]/);
  assert.equal(util.modelError('Other', err, res), err, 'helper-created Errors are idempotent');
  assert.notEqual(util.modelError('Fixture', { provider: 'Fixture', message: 'not an Error' }, res).message, undefined);
});

test('URL credentials, query secrets, known token shapes and label metadata are redacted', async t => {
  const password = 'opaque-url-password';
  const token = 'opaque-query-key';
  const known = `sk-proj-${'a'.repeat(30)}`;
  const url = `https://fixture-user:${password}@provider.test/v1?api_key=${token}&model=fixture`;
  t.mock.method(globalThis, 'fetch', async () => { throw new Error(`Could not connect to ${url}; key ${known}`); });
  const err = await rejected(util.modelFetch(`Fixture ${known}`, url, {}));
  noSecrets(err, [password, token, known, 'fixture-user']);
  assert.match(err.message, /provider\.test/);
  assert.match(err.message, /model=fixture/);
});

test('redaction precedes clipping, including credentials crossing both retained boundaries', async t => {
  const key = 'opaque-boundary-' + 'secret'.repeat(20);
  t.mock.method(globalThis, 'fetch', async () => new Response(''));
  const res = await util.modelFetch('Fixture', 'https://provider.test', { headers: { 'x-api-key': key } });
  const err = util.modelError('Fixture', `${'a'.repeat(5990)}${key}${'b'.repeat(18000)}${key}${'c'.repeat(5990)}`, res);
  noSecrets(err, [key, 'opaque-boundary-', 'secretsecret']);
  assert.ok(err.message.length < 12500);
  assert.match(err.message, /characters truncated/);
});

test('user abort keeps AbortError semantics and timeouts include the provider', async t => {
  const abort = new DOMException('The operation was aborted.', 'AbortError');
  const controller = new AbortController();
  controller.abort(abort);
  t.mock.method(globalThis, 'fetch', async () => { throw controller.signal.reason; });
  const err = await rejected(util.modelFetch('Fixture', 'https://provider.test', { signal: controller.signal }));
  assert.equal(err.name, 'AbortError');
  t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); });
  const timeout = await rejected(util.modelFetch('Fixture', 'https://provider.test', {}));
  assert.equal(timeout.name, 'TimeoutError');
  assert.match(timeout.message, /^Fixture: .*timed out/);
});

test('SSE accepts data without a space, split chunks, DONE and an EOF data event', async () => {
  const chunks = new ReadableStream({ start(c) {
    for (const value of ['data:{"a":1}\r\n\r\ndata: ', '{"b":2}\n\ndata:[DONE]\n\ndata:{"error":"real failure"}']) c.enqueue(new TextEncoder().encode(value));
    c.close();
  } });
  const events = [];
  for await (const event of util.sseEvents(chunks)) events.push(event);
  assert.deepEqual(events, [{ a: 1 }, { b: 2 }, { error: 'real failure' }]);
});

test('quota, HTTP status and retry-after behavior remain intact for Headers and plain headers', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: { message: 'Quota depleted', code: 'insufficient_quota' } }, { status: 429, headers: { 'retry-after': '120' } }); });
  const err = await rejected(util.postWithRetry('Fixture', 'https://provider.test', {}, {}));
  assert.equal(calls, 1);
  assert.deepEqual([err.status, err.code, err.retryAfter, util.outOfCredit(err)], [429, 'insufficient_quota', 120000, true]);
  const plain = util.modelError('Fixture', { error: 'Rate limited' }, { status: 429, headers: { 'Retry-After-Ms': '45000', 'X-Request-ID': 'plain-request' } });
  assert.deepEqual([plain.retryAfter, plain.requestId], [45000, 'plain-request']);
});

test('Anthropic SSE errors retain type, request ID and redacted request credentials', async t => {
  const key = process.env.ANTHROPIC_API_KEY = 'opaque-anthropic-fixture';
  t.mock.method(globalThis, 'fetch', async url => String(url).includes('/models') ? Response.json({ data: [] }) : sse([{ type: 'error', error: { type: 'overloaded_error', message: `Upstream overloaded ${key}` } }], { 'request-id': 'anthropic-request' }));
  const err = await rejected(anthropic.callAnthropic(params('claude-fixture'), sink()));
  assert.match(err.message, /^Anthropic: Upstream overloaded/);
  assert.deepEqual([err.type, err.requestId], ['overloaded_error', 'anthropic-request']);
  noSecrets(err, [key]);
});

test('compatible SSE string errors and context overflow retain original provider code', async t => {
  settings({ fixture: { name: 'Fixture', baseURL: 'https://provider.test/v1', apiKey: 'opaque-fixture-key' } });
  t.mock.method(globalThis, 'fetch', async () => new Response('data:{"error":"provider rejected this model"}', { headers: { 'x-request-id': 'compat-request' } }));
  const err = await rejected(compat.callCompat(params('fixture:model'), sink()));
  assert.match(err.message, /^Fixture: provider rejected/);
  assert.equal(err.requestId, 'compat-request');
  t.mock.method(globalThis, 'fetch', async () => sse([{ error: { message: 'Maximum context length exceeded', code: 400 } }]));
  const overflow = await rejected(compat.callCompat(params('fixture:model'), sink()));
  assert.deepEqual([overflow.code, overflow.providerCode], ['context_length_exceeded', 400]);
});

test('compatible network errors keep the actual TLS cause rather than is-it-running text', async t => {
  settings({ fixture: { name: 'Fixture', baseURL: 'https://provider.test/v1' } });
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) }); });
  const err = await rejected(compat.callCompat(params('fixture:model'), sink()));
  assert.match(err.message, /Fixture: fetch failed[\s\S]*unable to verify the first certificate/);
  assert.doesNotMatch(err.message, /Is it running/);
  assert.equal(err.code, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
});

test('Anthropic helpers report truncated or refused text instead of accepting partial output', async t => {
  const key = process.env.ANTHROPIC_API_KEY = 'opaque-partial-helper-key';
  for (const reason of ['max_tokens', 'refusal', 'model_context_window_exceeded', key]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ stop_reason: reason, content: [{ type: 'text', text: 'partial answer' }] }, { headers: { 'request-id': 'partial-helper' } }));
    const err = await rejected(anthropic.askAnthropic('claude-fixture', '', 'test'));
    assert.match(err.message, /stopped early[\s\S]*partial-helper/);
    noSecrets(err, [key]);
  }
});

test('HTTP 200 askAnthropic errors and malformed content cannot falsely succeed', async t => {
  for (const body of [{ error: { message: 'Invalid model', type: 'invalid_request_error' } }, { content: [] }, { content: [{ type: 'text' }] }, { content: 'not an array' }]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(body, { headers: { 'request-id': 'ask-request' } }));
    const err = await rejected(anthropic.askAnthropic('claude-fixture', '', 'test'));
    assert.match(err.message, /^Anthropic: (Invalid model|.*text content)/i);
    assert.equal(err.requestId, 'ask-request');
    assert.notEqual(err.name, 'TypeError');
  }
});

test('premature EOF, invalid JSON and midstream transport errors include request ID and causes', async t => {
  settings({ fixture: { name: 'Fixture', baseURL: 'https://provider.test/v1' } });
  for (const call of [() => compat.callCompat(params('fixture:model'), sink()), () => anthropic.callAnthropic(params('claude-fixture'), sink())]) {
    t.mock.method(globalThis, 'fetch', async () => new Response('', { headers: { 'x-request-id': 'eof-request' } }));
    const eof = await rejected(call());
    assert.match(eof.message, /stream ended unexpectedly/);
    assert.equal(eof.requestId, 'eof-request');
    t.mock.method(globalThis, 'fetch', async () => new Response('data: not json\n', { headers: { 'x-request-id': 'parser-request' } }));
    const parse = await rejected(call());
    assert.match(parse.message, /JSON|Unexpected token/);
    assert.equal(parse.requestId, 'parser-request');
    t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(c) { c.error(new TypeError('terminated', { cause: Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' }) })); } }), { headers: { 'x-request-id': 'socket-request' } }));
    const read = await rejected(call());
    assert.match(read.message, /terminated[\s\S]*socket closed/);
    assert.equal(read.requestId, 'socket-request');
  }
});

test('recognized compatible finish reasons preserve partial output and fixed incomplete values', async t => {
  settings({ fixture: { name: 'Fixture', baseURL: 'https://provider.test/v1' } });
  for (const [finish, want] of [['content_filter', 'content_filter'], ['length', 'max_output_tokens'], ['stop', undefined], ['tool_calls', undefined], ['function_call', undefined]]) {
    t.mock.method(globalThis, 'fetch', async () => sse([{ choices: [{ delta: { content: 'Partial answer' }, finish_reason: finish }] }]));
    const result = await compat.callCompat(params('fixture:model'), sink());
    assert.equal(result.incomplete, want);
    assert.equal(result.output[0].content[0].text, 'Partial answer');
    if (want === undefined) {
      t.mock.method(globalThis, 'fetch', async () => sse([{ choices: [{ delta: {}, finish_reason: finish }] }]));
      assert.equal((await compat.callCompat(params('fixture:model'), sink())).incomplete, undefined);
    }
  }
});

test('compatible non-normal finishes without usable text or calls fail with the actual reason and request ID', async t => {
  settings({ fixture: { name: 'Fixture', baseURL: 'https://provider.test/v1' } });
  for (const finish of ['content_filter', 'length']) {
    for (const content of ['', ' \n\t']) {
      t.mock.method(globalThis, 'fetch', async () => sse([{ choices: [{ delta: { content }, finish_reason: finish }] }], { 'request-id': 'empty-finish' }));
      const err = await rejected(compat.callCompat(params('fixture:model'), sink()));
      assert.match(err.message, /no text or tool calls/i);
      assert.ok(err.message.includes(finish));
      assert.equal(err.requestId, 'empty-finish');
    }
    t.mock.method(globalThis, 'fetch', async () => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-fixture', function: { name: 'fixture', arguments: '{}' } }] }, finish_reason: finish }] }]));
    const result = await compat.callCompat(params('fixture:model'), sink());
    assert.equal(result.output[0].type, 'function_call');
    assert.equal(result.incomplete, finish === 'length' ? 'max_output_tokens' : 'content_filter');
  }
});

test('compatible unknown finish reasons cannot persist echoed request credentials even after key rotation', async t => {
  const key = 'opaque-private-credential-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const overwrite of [false, true]) for (const finish of [key, 'future_finish_reason']) {
    settings({ fixture: { name: 'Fixture', baseURL: 'https://provider.test/v1', apiKey: key } });
    t.mock.method(globalThis, 'fetch', async () => {
      settings({ fixture: { name: 'Fixture', baseURL: 'https://provider.test/v1', apiKey: 'replacement-key' } });
      return sse([{ choices: [{ delta: { content: 'Partial answer' }, finish_reason: finish }] }, ...(overwrite ? [{ choices: [{ delta: {}, finish_reason: 'stop' }] }] : [])], { 'request-id': 'unknown-finish' });
    });
    const err = await rejected(compat.callCompat(params('fixture:model'), sink()));
    assert.match(err.message, /Unexpected model finish_reason/);
    assert.equal(err.requestId, 'unknown-finish');
    assert.ok(err.message.includes(finish === key ? '[REDACTED]' : finish));
    noSecrets(err, [key, key.slice(0, 10)]);
  }
});

test('Anthropic recognized stop reasons preserve partial output and fixed incomplete values', async t => {
  for (const [stop, want] of [['end_turn', undefined], ['tool_use', undefined], ['stop_sequence', undefined], ['max_tokens', 'max_output_tokens'], ['pause_turn', 'pause_turn'], ['refusal', 'refusal'], ['model_context_window_exceeded', 'model_context_window_exceeded']]) {
    t.mock.method(globalThis, 'fetch', async () => sse([{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Partial answer' } }, { type: 'message_delta', delta: { stop_reason: stop }, usage: {} }, { type: 'message_stop' }]));
    const result = await anthropic.callAnthropic(params('claude-fixture'), sink());
    assert.equal(result.incomplete, want);
    assert.equal(result.output[1].content[0].text, 'Partial answer');
  }
});

test('Anthropic requires a final stop reason and ignores null reasons in usage-only deltas', async t => {
  t.mock.method(globalThis, 'fetch', async () => sse([{ type: 'message_delta', delta: { stop_reason: null }, usage: {} }, { type: 'message_stop' }], { 'request-id': 'missing-stop' }));
  const err = await rejected(anthropic.callAnthropic(params('claude-fixture'), sink()));
  assert.match(err.message, /without a stop_reason/);
  assert.equal(err.requestId, 'missing-stop');
  t.mock.method(globalThis, 'fetch', async () => sse([{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: {} }, { type: 'message_delta', delta: { stop_reason: null }, usage: { output_tokens: 3 } }, { type: 'message_stop' }]));
  const result = await anthropic.callAnthropic(params('claude-fixture'), sink());
  assert.equal(result.incomplete, undefined);
  assert.equal(result.usage.output_tokens, 3);
});

test('Anthropic unknown stop reasons cannot persist echoed request credentials even after key rotation', async t => {
  const key = 'opaque-private-credential-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const overwrite of [false, true]) for (const stop of [key, 'future_stop_reason']) {
    process.env.ANTHROPIC_API_KEY = key;
    t.mock.method(globalThis, 'fetch', async url => {
      if (String(url).includes('/models')) return Response.json({ data: [] });
      process.env.ANTHROPIC_API_KEY = 'replacement-key';
      return sse([{ type: 'message_delta', delta: { stop_reason: stop }, usage: {} }, ...(overwrite ? [{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: {} }] : []), { type: 'message_stop' }], { 'request-id': 'unknown-stop' });
    });
    const err = await rejected(anthropic.callAnthropic(params('claude-fixture'), sink()));
    assert.match(err.message, /Unexpected model stop_reason/);
    assert.equal(err.requestId, 'unknown-stop');
    assert.ok(err.message.includes(stop === key ? '[REDACTED]' : stop));
    noSecrets(err, [key, key.slice(0, 10)]);
  }
});

for (const provider of ['compatible', 'Anthropic']) test(`${provider} malformed SSE parser errors omit credential prefixes`, async t => {
  const key = 'opaque-private-credential-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  process.env.ANTHROPIC_API_KEY = key;
  settings({ fixture: { name: 'Fixture', baseURL: 'https://provider.test/v1', apiKey: key } });
  t.mock.method(globalThis, 'fetch', async url => String(url).includes('/models') ? Response.json({ data: [] }) : new Response(`data:${key}`, { headers: { 'request-id': 'private-sse' } }));
  const err = await rejected(provider === 'compatible' ? compat.callCompat(params('fixture:model'), sink()) : anthropic.callAnthropic(params('claude-fixture'), sink()));
  noSecrets(err, [key, key.slice(0, 10)]);
  assert.match(err.message, /Invalid JSON response[\s\S]*SyntaxError[\s\S]*omitted for privacy/);
  assert.equal(err.requestId, 'private-sse');
});

test('askAnthropic malformed JSON parser errors omit credential prefixes', async t => {
  const key = process.env.ANTHROPIC_API_KEY = 'opaque-private-credential-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  t.mock.method(globalThis, 'fetch', async () => new Response(key, { headers: { 'request-id': 'private-ask' } }));
  const err = await rejected(anthropic.askAnthropic('claude-fixture', '', 'test'));
  noSecrets(err, [key, key.slice(0, 10)]);
  assert.match(err.message, /Invalid JSON response[\s\S]*SyntaxError[\s\S]*omitted for privacy/);
  assert.equal(err.requestId, 'private-ask');
});

test('nested native SyntaxError causes omit credential prefixes without losing transport details', async t => {
  const key = 'opaque-private-credential-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  t.mock.method(globalThis, 'fetch', async () => new Response('', { headers: { 'request-id': 'private-cause' } }));
  const res = await util.modelFetch('Fixture', 'https://provider.test', { headers: { authorization: `Bearer ${key}` } });
  let parse;
  try { JSON.parse(key); } catch (err) { parse = err; }
  assert.ok(parse instanceof SyntaxError);
  const cause = new AggregateError([parse], 'Response parsing failed');
  const err = util.modelError('Fixture', Object.assign(new TypeError('Could not decode response', { cause }), { code: 'UND_ERR_PARSE' }), res);
  noSecrets(err, [key, key.slice(0, 10)]);
  assert.match(err.message, /Could not decode response[\s\S]*Response parsing failed[\s\S]*Invalid JSON response[\s\S]*SyntaxError[\s\S]*omitted for privacy/);
  assert.deepEqual([err.code, err.providerCode, err.requestId, err.errors], ['UND_ERR_PARSE', 'UND_ERR_PARSE', 'private-cause', undefined]);
});

test('native SyntaxError diagnostics retain numeric locations but provider messages are unchanged', () => {
  let parse;
  try { JSON.parse('{\n '); } catch (err) { parse = err; }
  assert.ok(parse instanceof SyntaxError);
  const err = util.modelError('Fixture', parse);
  assert.match(err.message, /Invalid JSON response[\s\S]*SyntaxError[\s\S]*omitted for privacy/);
  const location = / at position \d+(?: \(line \d+ column \d+\))?$/.exec(parse.message)?.[0];
  if (location) assert.ok(err.message.includes(location), 'safe numeric parser locations are retained');
  const message = 'Provider says: Unexpected token in JSON at field model';
  assert.equal(util.modelError('Fixture', { error: { message, type: 'SyntaxError' } }).message.split('\n')[0], `Fixture: ${message}`);
});

test('malformed model-list JSON omits credential prefixes for both adapters', async t => {
  const key = process.env.ANTHROPIC_API_KEY = 'opaque-private-credential-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const fresh = await import('../server/anthropic.js?private-model-list');
  settings({ privatejson: { name: 'PrivateJSON', baseURL: 'https://privatejson.test/v1', apiKey: key } });
  t.mock.method(globalThis, 'fetch', async () => new Response(key, { headers: { 'request-id': 'private-list' } }));
  const err = await rejected(fresh.anthropicModels());
  noSecrets(err, [key, key.slice(0, 10)]);
  assert.match(err.message, /Invalid JSON response[\s\S]*omitted for privacy/);
  assert.equal(err.requestId, 'private-list');
  const errors = [];
  await compat.compatModels(errors);
  const message = errors.find(e => e.provider === 'privatejson')?.error;
  assert.ok(message);
  assert.equal(message.includes(key.slice(0, 10)), false);
  assert.match(message, /Invalid JSON response[\s\S]*omitted for privacy[\s\S]*private-list/);
});

test('compatModels collects safe list failures while returning healthy providers unchanged', async t => {
  const key = 'opaque-list-fixture';
  settings({ healthy: { name: 'Healthy', baseURL: 'https://healthy.test/v1' }, broken: { name: 'Broken', baseURL: 'https://broken.test/v1', apiKey: key }, envelope: { name: 'Envelope', baseURL: 'https://envelope.test/v1' } });
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('healthy.test')) return Response.json({ data: [{ id: 'coder' }] });
    if (String(url).includes('broken.test')) return Response.json({ error: { message: `Invalid credential ${key}`, code: 'invalid_api_key' } }, { status: 403, headers: { 'request-id': 'list-request' } });
    if (String(url).includes('envelope.test')) return Response.json({ error: 'HTTP 200 provider failure' });
    return Response.json({ data: [] });
  });
  const errors = [], models = await compat.compatModels(errors);
  assert.deepEqual(models.filter(m => m.provider === 'healthy').map(m => m.id), ['healthy:coder']);
  const error = errors.find(e => e.provider === 'broken');
  assert.match(error.error, /Broken 403: Invalid credential[\s\S]*invalid_api_key[\s\S]*list-request/);
  assert.equal(error.error.includes(key), false);
  assert.match(errors.find(e => e.provider === 'envelope').error, /HTTP 200 provider failure/);
  assert.deepEqual(Object.keys(error), ['provider', 'error']);
  assert.ok(Array.isArray(await compat.compatModels()));
});

test('quick retries still pace transient HTTP failures and return the healthy response', async t => {
  const waits = [], nativeTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => { waits.push(ms); return nativeTimeout(fn, 0, ...args); });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return calls <= 2 ? Response.json({ error: 'Transient failure' }, { status: calls === 1 ? 429 : 503 }) : Response.json({ healthy: true });
  });
  const res = await util.postWithRetry('RetryFixture', 'https://provider.test', {}, {});
  assert.deepEqual([calls, waits, await res.json()], [3, [2000, 4000], { healthy: true }]);
});

test('HTTP body read failures retain status and do not enter quick retries', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(new ReadableStream({ start(c) { c.error(new Error('response socket closed')); } }), { status: 503, headers: { 'x-request-id': 'read-failure' } });
  });
  const err = await rejected(util.postWithRetry('Fixture', 'https://provider.test', {}, {}));
  assert.deepEqual([calls, err.status, err.requestId], [1, 503, 'read-failure']);
  assert.match(err.message, /Fixture 503: response socket closed/);
});

test('bare URL key, encoded query values and unrelated URLs in messages are sanitized', async t => {
  const url = 'https://provider.test/v1?key=opaque+url%2Bsecret&model=fixture';
  t.mock.method(globalThis, 'fetch', async () => new Response(''));
  const res = await util.modelFetch('Fixture', url, {});
  const err = util.modelError('Fixture', `Denied ${url}; decoded opaque url+secret; raw opaque+url%2Bsecret; https://other.test/v1?key=unrelated-opaque-secret`, res);
  noSecrets(err, ['opaque url+secret', 'opaque+url%2Bsecret', 'unrelated-opaque-secret']);
  assert.match(err.message, /model=fixture/);
});

test('malformed auth headers still produce sanitized provider errors', async t => {
  const token = 'opaque-malformed\r\nheader';
  const authorization = `Bearer ${token}`;
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError(`Invalid header value ${JSON.stringify(authorization)} (${token})`); });
  const err = await rejected(util.modelFetch('Fixture', 'https://provider.test', { headers: { authorization } }));
  assert.match(err.message, /^Fixture: Invalid header value/);
  noSecrets(err, [token, JSON.stringify(authorization).slice(1, -1)]);
});

test('string error envelopes retain outer metadata and retry hints', () => {
  const err = util.modelError('Fixture', { error: 'Account cannot access this model', code: 'model_forbidden', type: 'permission_error', status: 403, retryAfter: 45000, request_id: 'envelope-request' });
  assert.deepEqual([err.status, err.code, err.type, err.retryAfter, err.requestId], [403, 'model_forbidden', 'permission_error', 45000, 'envelope-request']);
  assert.match(err.message, /^Fixture 403: Account cannot access this model/);
});

test('nonstandard validation errors are useful without dumping echoed requests or raw properties', () => {
  const detail = { detail: [{ msg: 'Field required: model', type: 'missing' }], headers: { authorization: 'private-header' }, request: { messages: ['private-prompt'] }, stack: 'private-stack' };
  const err = util.modelError('Fixture', detail, { status: 400 });
  assert.match(err.message, /^Fixture 400: Field required: model/);
  noSecrets(err, ['private-header', 'private-prompt', 'private-stack']);
  const fake = new Error('not built by helper');
  fake.provider = 'Fixture';
  assert.notEqual(util.modelError('Fixture', fake), fake, 'an arbitrary provider property cannot bypass sanitation');
  assert.equal(fs.existsSync(path.join(tmp, 'keys.json')), false, 'redaction never saves incoming secrets');
});

test('cyclic and large aggregate causes are explicitly bounded', () => {
  const error = new AggregateError(Array.from({ length: 200 }, (_, i) => Object.assign(new Error(`connection ${i}`), { code: `CODE_${i}` })), 'All connections failed');
  error.cause = error;
  const err = util.modelError('Fixture', error);
  assert.match(err.message, /connection 0[\s\S]*CODE_0/);
  assert.match(err.message, /additional causes truncated/);
  assert.ok(err.message.length < 12500);
  assert.equal(err.errors, undefined);
});

test('HTTP 200 list envelopes, malformed list JSON and ask JSON retain request IDs', async t => {
  for (const body of [{ error: { message: 'Model access denied', type: 'permission_error' } }, 'not-json']) {
    process.env.ANTHROPIC_API_KEY = 'opaque-list-json';
    const fresh = await import(`../server/anthropic.js?list-envelope=${typeof body}`);
    t.mock.method(globalThis, 'fetch', async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'x-goog-request-id': 'json-request' } }));
    const err = await rejected(fresh.anthropicModels());
    assert.equal(err.requestId, 'json-request');
    assert.match(err.message, /Anthropic: (Model access denied|.*JSON|.*Unexpected token)/);
  }
  t.mock.method(globalThis, 'fetch', async () => new Response('not-json', { headers: { 'request-id': 'ask-json' } }));
  assert.equal((await rejected(anthropic.askAnthropic('claude-fixture', '', 'test'))).requestId, 'ask-json');
});

test('Anthropic context overflow preserves the original code and stream abort remains an AbortError', async t => {
  t.mock.method(globalThis, 'fetch', async () => sse([{ type: 'error', error: { message: 'prompt is too long', code: 'input_limit', type: 'invalid_request_error' } }]));
  const overflow = await rejected(anthropic.callAnthropic(params('claude-fixture'), sink()));
  assert.deepEqual([overflow.code, overflow.providerCode], ['context_length_exceeded', 'input_limit']);
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(c) { c.error(new DOMException('Aborted by user', 'AbortError')); } }), { headers: { 'request-id': 'stream-abort' } }));
  const abort = await rejected(anthropic.callAnthropic(params('claude-fixture'), sink()));
  assert.deepEqual([abort.name, abort.requestId], ['AbortError', 'stream-abort']);
});

test('Anthropic model-list cache does not hide a replaced or removed key', async t => {
  const fresh = await import('../server/anthropic.js?key-rotation');
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests++;
    if (init.headers['x-api-key'] === 'fixture-good-key') return Response.json({ data: [{ id: 'claude-fixture', display_name: 'Fixture' }] });
    return Response.json({ error: { message: 'Rotated key was rejected', type: 'authentication_error' } }, { status: 401, headers: { 'request-id': 'rotated-key' } });
  });
  process.env.ANTHROPIC_API_KEY = 'fixture-good-key';
  assert.equal((await fresh.anthropicModels()).length, 1);
  assert.equal((await fresh.anthropicModels()).length, 1);
  assert.equal(requests, 1, 'the same key still uses its model cache');
  process.env.ANTHROPIC_API_KEY = 'fixture-replaced-key';
  await assert.rejects(fresh.anthropicModels(), /Rotated key was rejected[\s\S]*rotated-key/);
  assert.equal(requests, 2, 'a replacement key is actually checked');
  delete process.env.ANTHROPIC_API_KEY;
  assert.deepEqual(await fresh.anthropicModels(), [], 'a removed key cannot keep reporting connected models');
});

test('Anthropic list failures report the body, HTTP status and request ID', async t => {
  process.env.ANTHROPIC_API_KEY = 'opaque-anthropic-list';
  // Earlier empty catalogs do not bypass this request: use a fresh adapter cache.
  const fresh = await import('../server/anthropic.js?model-errors-list');
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'Access denied for this account', type: 'permission_error' } }, { status: 403, headers: { 'request-id': 'anthropic-list' } }));
  const err = await rejected(fresh.anthropicModels());
  assert.match(err.message, /^Anthropic 403: Access denied/);
  assert.deepEqual([err.type, err.requestId], ['permission_error', 'anthropic-list']);
});
