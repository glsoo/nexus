import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-'));
process.env.NEXUS_PROJECTS = path.join(tmp, 'projects');
process.env.NEXUS_HOME = path.join(tmp, 'home');
const projects = await import('../server/projects.js');
const { decide, edit } = await import('../server/tools.js');
const { loginBlocked, recordFail, clearFails } = await import('../server/auth.js');
const { autoName, getSession, publicState, requestBody, resumeAfterRestart, stopForRestart, submit } = await import('../server/agent.js');
const { sseEvents } = await import('../server/util.js');
const { callAnthropic, toMessages } = await import('../server/anthropic.js');
const { checkpoint } = { checkpoint: await import('../server/checkpoint.js') };
const state = (mode, allow = []) => ({ mode, allow });

test('project names cannot escape ~/projects', () => {
  for (const bad of ['../evil', 'a/b', '.hidden', 'x'.repeat(65)]) assert.throws(() => projects.create(bad));
  assert.equal(projects.exists('..'), false);
});

test('rename moves the directory and refuses to overwrite', () => {
  projects.create('one'); projects.create('two');
  assert.throws(() => projects.rename('one', 'two'), /already exists/);
  projects.rename('one', 'three');
  assert.ok(projects.exists('three') && !projects.exists('one'));
});

test('permissions', () => {
  const cwd = projects.projectDir('two');
  assert.equal(decide(state('default'), 'Read', { file_path: 'a.txt' }, cwd).action, 'allow');
  assert.equal(decide(state('default'), 'Read', { file_path: '../x' }, cwd).action, 'ask');
  assert.equal(decide(state('default'), 'Read', { file_path: '~/.ssh/id_rsa' }, cwd).action, 'ask');
  assert.equal(decide(state('default'), 'Write', { file_path: 'a' }, cwd).action, 'ask');
  assert.equal(decide(state('acceptEdits'), 'Write', { file_path: 'a' }, cwd).action, 'allow');
  assert.equal(decide(state('acceptEdits'), 'Write', { file_path: '/etc/x' }, cwd).action, 'ask');
  assert.equal(decide(state('acceptEdits'), 'Write', { file_path: '.nexus/agents/x.md' }, cwd).action, 'ask');
  assert.equal(decide(state('acceptEdits'), 'Bash', { command: 'ls' }, cwd).action, 'ask');
  assert.equal(decide(state('plan'), 'Bash', { command: 'ls' }, cwd).action, 'deny');
  assert.equal(decide(state('default', ['Bash:ls']), 'Bash', { command: 'ls' }, cwd).action, 'allow');
  assert.equal(decide(state('default', ['Bash:ls']), 'Bash', { command: 'ls; rm -rf ~' }, cwd).action, 'ask');
  assert.equal(decide(state('bypass'), 'Bash', { command: 'ls' }, cwd).action, 'allow');
});

test('edit requires a unique match', () => {
  const cwd = projects.projectDir('two');
  fs.writeFileSync(path.join(cwd, 'f'), 'a a b');
  assert.throws(() => edit({ file_path: 'f', old_string: 'a', new_string: 'c' }, { cwd }), /2 times/);
  edit({ file_path: 'f', old_string: 'b', new_string: 'c' }, { cwd });
  edit({ file_path: 'f', old_string: 'a', new_string: 'z', replace_all: true }, { cwd });
  assert.equal(fs.readFileSync(path.join(cwd, 'f'), 'utf8'), 'z z c');
});

test('login throttle per IP and globally', () => {
  clearFails();
  for (let i = 0; i < 5; i++) recordFail('1.1.1.1');
  assert.ok(loginBlocked('1.1.1.1'));
  assert.ok(!loginBlocked('2.2.2.2'));
  assert.ok(!loginBlocked('1.1.1.1', Date.now() + 901_000));
  for (let i = 0; i < 25; i++) recordFail(`3.3.3.${i}`);
  assert.ok(loginBlocked('9.9.9.9'));
  clearFails();
});

test('unanswered tool calls get an output so the API accepts the history', () => {
  const items = [{ type: 'function_call', call_id: 'a' }, { type: 'function_call_output', call_id: 'a' }, { type: 'function_call', call_id: 'b' }];
  projects.repairItems(items);
  assert.deepEqual(items.at(-1).call_id, 'b');
  assert.equal(items.length, 4);
});

test('a rejected image can be dropped from history', () => {
  const items = [
    { type: 'function_call_output', call_id: 'a', output: [{ type: 'input_image', image_url: 'data:x' }] },
    { role: 'user', content: [{ type: 'input_text', text: 'hi' }, { type: 'input_image', image_url: 'data:x' }] },
    { type: 'function_call_output', call_id: 'b', output: 'text' },
  ];
  assert.equal(projects.dropImages(items), 2);
  assert.equal(JSON.stringify(items).includes('input_image'), false);
  assert.equal(items[2].output, 'text');
  assert.equal(projects.dropImages(items), 0);
});

test('SSE parser handles events split across chunks', async () => {
  const body = new Response('data: {"a":1}\n\nevent: x\ndata: {"b"').body;
  const chunks = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"a":1}\n\ndata: {"b"')); c.enqueue(new TextEncoder().encode(':2}\n\n')); c.close(); } });
  body.cancel();
  const got = [];
  for await (const ev of sseEvents(chunks)) got.push(ev);
  assert.deepEqual(got, [{ a: 1 }, { b: 2 }]);
});

test('checkpoint restores deleted and changed files', async () => {
  const cwd = projects.projectDir('two');
  fs.writeFileSync(path.join(cwd, 'keep'), 'v1');
  const sha = await checkpoint.snapshot(cwd);
  fs.writeFileSync(path.join(cwd, 'keep'), 'v2');
  fs.writeFileSync(path.join(cwd, 'new'), 'x');
  assert.match(await checkpoint.diff(cwd, sha), /\+v2/);
  await checkpoint.restore(cwd, sha);
  assert.equal(fs.readFileSync(path.join(cwd, 'keep'), 'utf8'), 'v1');
  assert.ok(!fs.existsSync(path.join(cwd, 'new')));
});

test('the model names an untitled chat, and the prompt is the fallback', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'Login-Bug-Fix.\n' }] }] });
    projects.create('untitled-7');
    const named = getSession('untitled-7');
    await autoName(named, 'the login page is broken');
    assert.equal(named.name, 'login-bug-fix');
    assert.ok(projects.exists('login-bug-fix'));

    await autoName(named, 'a later prompt');
    assert.equal(named.name, 'login-bug-fix');

    globalThis.fetch = async () => new Response('{"error":{"message":"no"}}', { status: 400 });
    projects.create('untitled-8');
    const fallback = getSession('untitled-8');
    await autoName(fallback, 'Make me a site.');
    assert.equal(fallback.name, 'make-me-a-site');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a chat can move between Anthropic and OpenAI', async () => {
  const realFetch = globalThis.fetch;
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 5, cache_read_input_tokens: 90, cache_creation_input_tokens: 5 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Reading.' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"path":"a"}' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } },
    { type: 'message_stop' },
  ];
  let sent;
  try {
    process.env.ANTHROPIC_API_KEY = 'test';
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('/v1/models')) return Response.json({ data: [{ id: 'sonnet-x', display_name: 'X', max_tokens: 1000, capabilities: { effort: { low: { supported: true }, high: { supported: true } }, thinking: { types: { adaptive: { supported: true } } } } }] });
      sent = JSON.parse(init.body);
      return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''));
    };
    const sink = { add: e => e, update() {}, delta() {} };
    const params = { model: 'sonnet-x', effort: 'xhigh', instructions: 'sys', tools: [{ type: 'function', name: 'Read', description: 'd', parameters: {}, strict: true }, { type: 'web_search' }] };
    const image = 'data:image/png;base64,AAAA';
    const openaiTurn = [
      { role: 'user', content: [{ type: 'input_text', text: 'look' }, { type: 'input_image', image_url: image }] },
      { type: 'reasoning', id: 'rs_1', encrypted_content: 'x' },
      { type: 'function_call', call_id: 'call_1', name: 'Read', arguments: '{"path":"b"}' },
      { type: 'function_call_output', call_id: 'call_1', output: [{ type: 'input_image', image_url: image }] },
      { type: 'function_call_output', call_id: 'call_2', output: 'ok' },
    ];
    const { output, usage, incomplete } = await callAnthropic({ ...params, input: openaiTurn }, sink);

    assert.equal(sent.output_config.effort, 'high');
    assert.equal(sent.max_tokens, 1000);
    assert.deepEqual(sent.tools[0], { name: 'Read', description: 'd', input_schema: {} });
    assert.deepEqual(sent.messages.map(m => m.role), ['user', 'assistant', 'user']);
    assert.equal(sent.messages[0].content[1].source.data, 'AAAA');
    assert.equal(sent.messages[2].content.length, 2);
    assert.equal(sent.messages[2].content[0].content[0].source.media_type, 'image/png');

    assert.equal(incomplete, undefined);
    assert.equal(usage.input_tokens, 100);
    assert.equal(usage.input_tokens_details.cached_tokens, 90);
    assert.equal(output.at(-1).arguments, '{"path":"a"}');

    const history = [{ role: 'user', content: 'hi' }, ...output, { type: 'function_call_output', call_id: 'toolu_1', output: 'file' }];
    const replay = toMessages(history);
    assert.equal(replay[1].content[0].signature, 'sig');
    assert.deepEqual(replay[1].content.map(b => b.type), ['thinking', 'text', 'tool_use']);
    assert.equal(replay[2].content[0].tool_use_id, 'toolu_1');

    const openai = requestBody({ model: 'gpt-6', effort: 'max', input: history, tools: [] });
    assert.deepEqual(openai.input.map(i => i.type), [undefined, 'message', 'function_call', 'function_call_output']);
    assert.ok(openai.input.every(i => !('anthropic' in i)));
    assert.equal(openai.reasoning.effort, 'xhigh');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('/autocompact turns it off, sets a size, and survives a reload', async () => {
  projects.create('auto');
  const s = getSession('auto');
  const at = async arg => { await submit('auto', `/autocompact ${arg}`); return publicState(s).compactAt; };
  assert.equal(await at('off'), 0);
  assert.equal(await at('150k'), 150000);
  assert.equal(projects.load('auto').autoCompact, 150000);
  assert.equal(await at('nonsense'), 150000);
  assert.equal(s.state.log.at(-1).type, 'error');
  assert.equal(await at('5'), 10000);
  assert.equal(await at('on'), 300000);
});

test('OpenAI requests carry a cache key only when given one', () => {
  const base = { model: 'gpt-5', effort: 'low', instructions: '', input: [], tools: [] };
  assert.equal(requestBody({ ...base, cacheKey: 'p' }).prompt_cache_key, 'p');
  assert.equal('prompt_cache_key' in requestBody(base), false);
});

// Keep last: stopForRestart leaves this process refusing to start new turns.
test('a restart stops a running turn and the next boot queues it to continue', async () => {
  projects.create('resume');
  fs.mkdirSync(path.join(process.env.NEXUS_PROJECTS, 'resume', '.nexus'), { recursive: true });
  const s = getSession('resume');
  s.running = true;
  s.controller = new AbortController();
  s.controller.signal.addEventListener('abort', () => { s.running = false; });
  await stopForRestart();
  assert.equal(s.running, false);
  resumeAfterRestart();
  assert.match(s.queue[0].text, /server restarted/);
  s.queue.length = 0;
  resumeAfterRestart();
  assert.equal(s.queue.length, 0, 'resumes only once');
});
