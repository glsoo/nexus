import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const part = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing server section: ${start}`);
  return source.slice(a, b);
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const diagnostic = 'OpenAI HTTP 401: synthetic key rejected\ncode: invalid_api_key\nrequest id: req_test';
const modelError = (provider, detail, res) => Object.assign(new Error(`${provider}${res ? ` HTTP ${res.status}` : ''}: ${typeof detail === 'string' ? detail : detail.message}`), {
  provider, ...(res?.status >= 400 ? { status: res.status } : {}),
});

async function boundary(t, extra = {}) {
  const logs = [], routes = [];
  const context = vm.createContext({
    URL, RAW: Symbol(), SECURITY: {}, fail,
    console: { error: (...args) => { logs.push(args); } },
    cookieToken: req => req.headers.cookie,
    auth: { validSession: token => token === 'synthetic-session' },
    originOk: () => true, routes, ...extra,
  });
  vm.runInContext([
    part('async function api(req, res, url)', '\n// /present/'),
    part('async function handle(req, res)', '\n// ---- WebSockets'),
    'this.handle = handle;',
  ].join('\n'), context);
  const server = http.createServer((req, res) => context.handle(req, res).catch(err => { res.writeHead(599).end(err.message); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = async (pathname, cookie = 'synthetic-session') => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${pathname}`, { headers: cookie ? { cookie } : {} });
    return { status: res.status, body: await res.json() };
  };
  return { context, logs, routes, request };
}

test('API boundary maps provider failures to 502 with safe JSON/logging and leaves Nexus 401 alone', async t => {
  const fixture = await boundary(t);
  let thrown;
  fixture.routes.push({ method: 'GET', re: /^\/api\/failure$/, fn: () => { throw thrown; } });
  for (const status of [401, 402, 429, undefined]) {
    thrown = Object.assign(new Error(diagnostic, { cause: new Error('PRIVATE CAUSE MUST NOT BE LOGGED') }), { provider: 'OpenAI', ...(status ? { status } : {}) });
    const res = await fixture.request('/api/failure');
    assert.equal(res.status, 502, 'the upstream status must not become a Nexus authentication/status code');
    assert.deepEqual(res.body, { error: diagnostic, provider: 'OpenAI' });
    for (const args of fixture.logs) {
      assert.ok(args.every(arg => typeof arg === 'string'), 'no raw model Error or cause object is logged');
      assert.ok(!args.join(' ').includes('PRIVATE CAUSE'));
    }
  }
  assert.deepEqual(await fixture.request('/api/failure', ''), { status: 401, body: { error: 'Sign in first.' } });
  thrown = fail(400, 'Invalid request.');
  assert.deepEqual(await fixture.request('/api/failure'), { status: 400, body: { error: 'Invalid request.' } });
  thrown = Object.assign(new Error('Missing file.'), { code: 'ENOENT' });
  assert.deepEqual(await fixture.request('/api/failure'), { status: 404, body: { error: 'Missing file.' } });
});

function registerModels(context) {
  vm.runInContext(part("route('GET', '/api/models',", '\n// ---- HTTP'), context);
}

test('models details returns partial successes plus safe per-provider errors, while legacy callers still get an array', async t => {
  const good = [{ id: 'groq:working', provider: 'groq' }];
  const fixture = await boundary(t, {
    modelError,
    anthropicModels: async () => { throw Object.assign(new Error(diagnostic.replaceAll('OpenAI', 'Anthropic')), { provider: 'Anthropic', status: 401 }); },
    openaiModels: async () => [{ id: 'gpt-test', provider: 'openai' }],
    compatModels: async (errors = []) => { errors.push({ provider: 'ollama', error: 'Ollama connection refused\nCause: ECONNREFUSED' }); return good; },
  });
  fixture.context.route = (method, pattern, fn) => fixture.routes.push({ method, re: new RegExp(`^${pattern}$`), fn });
  registerModels(fixture.context);
  const details = await fixture.request('/api/models?details=1');
  assert.equal(details.status, 200);
  assert.deepEqual(details.body.models.map(m => m.id), ['gpt-test', 'groq:working']);
  assert.ok(details.body.errors.some(e => e.provider === 'anthropic' && e.error.includes('req_test')));
  assert.ok(details.body.errors.some(e => e.provider === 'ollama' && e.error.includes('ECONNREFUSED')));
  const legacy = await fixture.request('/api/models');
  assert.equal(legacy.status, 200);
  assert.deepEqual(legacy.body.map(m => m.id), details.body.models.map(m => m.id));
});

test('models details is readable when every provider fails, and the old endpoint throws a collected provider failure', async t => {
  const fixture = await boundary(t, {
    modelError, anthropicModels: async () => [], openaiModels: async () => [],
    compatModels: async (errors = []) => { errors.push({ provider: 'gemini', error: 'Google Gemini HTTP 403: project is disabled\nrequest id: google_test' }); return []; },
  });
  fixture.context.route = (method, pattern, fn) => fixture.routes.push({ method, re: new RegExp(`^${pattern}$`), fn });
  registerModels(fixture.context);
  const details = await fixture.request('/api/models?details=1');
  assert.equal(details.status, 200);
  assert.deepEqual(details.body.models, []);
  assert.equal(details.body.errors[0].provider, 'gemini');
  const legacy = await fixture.request('/api/models');
  assert.equal(legacy.status, 502);
  assert.equal(legacy.body.provider, 'gemini');
  assert.equal(legacy.body.error, details.body.errors[0].error);
});

test('models details has no diagnostic for providers without a key', async t => {
  const fixture = await boundary(t, { modelError, anthropicModels: async () => [], openaiModels: async () => [], compatModels: async () => [] });
  fixture.context.route = (method, pattern, fn) => fixture.routes.push({ method, re: new RegExp(`^${pattern}$`), fn });
  registerModels(fixture.context);
  assert.deepEqual(await fixture.request('/api/models?details=1'), { status: 200, body: { models: [], errors: [] } });
});

function openaiFixture() {
  let key = 'synthetic-first', response = { data: [{ id: 'gpt-4-test' }] }, calls = 0;
  const context = vm.createContext({
    createHash, Date, AbortSignal, modelError, agent: { supportsReasoning: () => false },
    apiKey: () => key,
    // No real provider or environment is used. The shared model helper supplies safe Errors.
    modelFetch: async () => {
      calls++;
      if (response instanceof Error) throw modelError('OpenAI', response);
      return { status: response.status || 200, ok: !response.status || response.status < 400,
        text: async () => response.body, json: async () => { if (response.parseError) throw new Error('Invalid JSON body'); return response; } };
    },
    fetch: async () => { throw new Error('OpenAI models must use modelFetch, not raw fetch'); },
  });
  vm.runInContext(`${part('let modelCache =', '\n// One provider')}\nthis.models = openaiModels;`, context);
  return { models: () => context.models(), calls: () => calls, setKey: value => { key = value; }, setResponse: value => { response = value; } };
}

test('OpenAI models cache belongs to its key and preserves actual upstream HTTP/body errors', async () => {
  const fixture = openaiFixture();
  assert.equal((await fixture.models())[0].id, 'gpt-4-test');
  await fixture.models();
  assert.equal(fixture.calls(), 1);
  fixture.setKey('synthetic-replaced-invalid');
  fixture.setResponse({ status: 401, body: 'incorrect API key\nrequest id: upstream_test' });
  await assert.rejects(fixture.models(), err => err.provider === 'OpenAI' && err.status === 401 && err.message.includes('incorrect API key\nrequest id: upstream_test'));
  assert.equal(fixture.calls(), 2, 'a changed key must not claim Connected from cached models');
  fixture.setKey('');
  assert.equal((await fixture.models()).length, 0, 'removing a key cannot reuse its old list');
});

test('OpenAI models preserves transport failures and adds provider context to invalid JSON/schema', async () => {
  for (const response of [new Error('connect ECONNREFUSED'), { parseError: true }, { data: null }, { data: [{ id: 123 }] }]) {
    const fixture = openaiFixture(); fixture.setResponse(response);
    await assert.rejects(fixture.models(), err => err.provider === 'OpenAI' && /OpenAI/.test(err.message));
  }
});

test('OpenAI model listing uses the real shared helpers to redact HTTP, parser and transport diagnostics', async t => {
  const { modelFetch, modelError } = await import('../server/util.js');
  const key = 'synthetic-request-credential';
  const responses = [
    () => new Response(JSON.stringify({ error: { message: `Rejected ${key}`, code: 'invalid_api_key' } }), { status: 401, headers: { 'x-request-id': 'real-helper-test' } }),
    () => new Response(`invalid JSON ${key}`),
    () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error(`Connection refused for ${key}`), { code: 'ECONNREFUSED' }) }); },
  ];
  for (const response of responses) {
    t.mock.method(globalThis, 'fetch', async () => response());
    const context = vm.createContext({ createHash, Date, AbortSignal, modelFetch, modelError, apiKey: () => key, agent: { supportsReasoning: () => false } });
    const load = vm.runInContext(`${part('let modelCache =', '\n// One provider')}\nopenaiModels;`, context);
    await assert.rejects(load(), err => {
      assert.equal(err.provider, 'OpenAI');
      assert.ok(!err.message.includes(key));
      if (err.status === 401) { assert.match(err.message, /\[REDACTED\]/); assert.match(err.message, /invalid_api_key/); assert.match(err.message, /real-helper-test/); }
      else if (err.message.includes('fetch failed')) { assert.match(err.message, /\[REDACTED\]/); assert.match(err.message, /ECONNREFUSED/); }
      else assert.match(err.message, /Could not read models response\.[\s\S]*Cause:.*JSON/);
      return true;
    });
  }
});

test('failed chats always broadcast failure state, but OS error notifications stay opt-in', async () => {
  for (const allowed of [false, true]) {
    const broadcasts = [], pushes = [], desktop = [], handlers = {};
    const context = vm.createContext({
      Set, WeakSet, PORT: 7799, wss: { clients: [] }, sendTo() {},
      projects: { chatOf: () => false }, auth: { liveSessionKey: 'synthetic-session' },
      push: { notify: async value => { pushes.push(value); } },
      notify: { desktopNotify: (...args) => { desktop.push(args); } },
      readSettings: () => ({ notifyErrors: allowed }), broadcast: value => { broadcasts.push(value); },
      agent: { hub: { on: (event, fn) => { handlers[event] = fn; } }, getSession: () => ({ state: { log: [
        { type: 'assistant', text: 'Old successful reply.' }, { type: 'error', text: diagnostic },
      ] } }) },
      console,
    });
    vm.runInContext(part('const busy = new Set()', "\nagent.hub.on('agent'"), context);
    handlers.project('failed-chat', { t: 'status', running: true });
    handlers.project('failed-chat', { t: 'status', running: false });
    const alert = broadcasts.find(e => e.t === 'alert');
    assert.equal(alert.kind, 'error');
    assert.match(alert.body, /synthetic key rejected/);
    assert.match(alert.title, /stopped on an error/);
    assert.equal(alert.notify, allowed);
    assert.equal(pushes.length, allowed ? 1 : 0);
    assert.equal(desktop.length, allowed ? 1 : 0);
    context.agent.getSession = () => ({ state: { log: [{ type: 'assistant', text: 'Done.' }] } });
    handlers.project('good-chat', { t: 'status', running: true });
    handlers.project('good-chat', { t: 'status', running: false });
    assert.equal(broadcasts.findLast(e => e.t === 'alert').kind, 'finished');
    assert.equal(pushes.length, allowed ? 2 : 1);
    assert.equal(desktop.length, allowed ? 2 : 1);
  }
});
