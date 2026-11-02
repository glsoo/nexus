import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-features-'));
process.env.NEXUS_PROJECTS = path.join(tmp, 'projects');
process.env.NEXUS_HOME = path.join(tmp, 'home');
const projects = await import('../server/projects.js');
const agent = await import('../server/agent.js');
const { DEFAULT_BASE, promptParts, savePrompts, withInjection } = await import('../server/prompts.js');
const mcp = await import('../server/mcp.js');
const market = await import('../server/market.js');
const settingsFile = path.join(process.env.NEXUS_HOME, 'settings.json');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A model that records what it was sent and answers "ok", unless call(n) names a tool [name, args] for its nth request.
function fakeModel(call = () => null) {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('api.openai.com/v1/responses')) return realFetch(url, init);
    sent.push(JSON.parse(init.body));
    const tool = call(sent.length);
    const output = tool ? [{ type: 'function_call', call_id: `call${sent.length}`, name: tool[0], arguments: JSON.stringify(tool[1]) }]
      : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }];
    const done = { type: 'response.completed', response: { output, usage: { input_tokens: 1, output_tokens: 1 } } };
    return new Response(`data: ${JSON.stringify(done)}\n\n`);
  };
  return { sent, restore: () => { globalThis.fetch = realFetch; } };
}
const idle = async (s, ms = 5000) => { for (let t = 0; t < ms && (s.running || s.queue.length); t += 25) await new Promise(r => setTimeout(r, 25)); };

test('prompt layers: global rewrites the base, project and chat add to it, and injections combine', () => {
  const cwd = path.join(tmp, 'layers');
  fs.mkdirSync(cwd, { recursive: true });
  const state = {};
  assert.equal(promptParts(cwd, state).base, DEFAULT_BASE);
  assert.equal(promptParts(cwd, state).custom, '');

  savePrompts('global', { system: 'You are a pirate.', inject: 'Say arr.' }, cwd, state);
  savePrompts('project', { system: 'Use tabs.', inject: '' }, cwd, state);
  savePrompts('chat', { system: 'Be brief.', inject: 'No emoji.' }, cwd, state);
  const parts = promptParts(cwd, state);
  assert.equal(parts.base, 'You are a pirate.');
  assert.match(parts.custom, /## This project\nUse tabs\.[\s\S]*## This chat\nBe brief\./);
  assert.equal(parts.inject, 'Say arr.\n\nNo emoji.');

  // Saving the unchanged default keeps following it, rather than freezing a copy.
  savePrompts('global', { system: DEFAULT_BASE, inject: '' }, cwd, state);
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.NEXUS_HOME, 'prompts.json'), 'utf8')).system, '');
  assert.throws(() => savePrompts('everywhere', {}, cwd, state), /Unknown prompt scope/);
  assert.equal(withInjection('hi', ''), 'hi');
});

test('a chat sends its injection with each prompt, works as its agent, and keeps the visible text clean', async () => {
  projects.create('swap');
  const s = agent.getSession('swap');
  const cwd = projects.projectDir('swap');
  fs.mkdirSync(path.join(cwd, '.nexus/agents'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.nexus/agents/reviewer.md'), '---\nname: reviewer\ndescription: Reviews\ntools: Read, Grep\n---\nOnly review, never edit.\n');

  assert.throws(() => agent.setOption(s, 'agent', 'nobody'), /no agent type called nobody/);
  assert.throws(() => agent.setOption(s, 'agent', 'Explore'), /no agent type/, 'built-in types are for subagents');
  assert.throws(() => agent.setOption(s, 'items', []), /Unknown option items/);
  agent.setOption(s, 'agent', 'reviewer');
  agent.setPrompts('swap', 'chat', { system: 'Answer in French.', inject: 'Cite file paths.' });

  const model = fakeModel();
  try {
    await agent.submit('swap', 'look at main.js');
    await idle(s);
  } finally { model.restore(); }

  const [req] = model.sent;
  assert.match(req.instructions, /# Your role: reviewer[\s\S]*Only review, never edit\./);
  assert.match(req.instructions, /## This chat\nAnswer in French\./);
  assert.deepEqual(req.tools.map(t => t.name || t.type).sort(), ['AskUserQuestion', 'ExitPlanMode', 'Grep', 'Read', 'TodoWrite']);
  const at = req.input.findIndex(i => i.role === 'user' && i.content.startsWith('look at main.js'));
  assert.match(req.input[at].content, /^look at main\.js\n\n---\nStanding instructions from the user, added to every message:\nCite file paths\.$/);
  // The switch is said in the conversation right before the next message, since models lean on recent history.
  assert.match(req.input[at - 1].content, /switched this chat to the "reviewer" agent/);
  assert.ok(s.state.log.some(e => e.type === 'system' && /Switched to the \*\*reviewer\*\* agent/.test(e.text)));
  assert.equal(s.state.agentSwitch, undefined, 'announced once');
  const entry = s.state.log.find(e => e.type === 'user');
  assert.equal(entry.text, 'look at main.js');
  assert.equal(entry.injected, true);
  assert.match(agent.previewPrompt('swap'), /# Your role: reviewer/);

  // /clear starts a fresh conversation: the chat's own prompts go, the agent choice stays.
  await agent.submit('swap', '/clear');
  assert.deepEqual(agent.getPrompts('swap').chat, { system: '', inject: '' });
  assert.equal(s.state.agent, 'reviewer');
  agent.setOption(s, 'agent', '');
  assert.doesNotMatch(agent.previewPrompt('swap'), /# Your role/);
});

test('autopilot in plan mode: plan stays read-only, then the plan approves itself and the work gets done', async () => {
  projects.create('pilot');
  const s = agent.getSession('pilot');
  const outside = path.join(tmp, 'outside.txt');
  fs.writeFileSync(outside, 'from outside');
  agent.setOption(s, 'mode', 'plan');
  agent.setOption(s, 'autopilot', true);
  const script = [
    ['Write', { file_path: 'a.txt', content: 'too early' }],
    ['ExitPlanMode', { plan: '1. Write a.txt' }],
    ['Write', { file_path: 'a.txt', content: 'hi' }],
    ['Read', { file_path: outside }],
    ['AskUserQuestion', { question: 'Tabs or spaces?' }],
  ];
  const model = fakeModel(n => script[n - 1]);
  try {
    await agent.submit('pilot', 'make a.txt');
    await idle(s);
  } finally { model.restore(); }

  assert.match(model.sent[0].instructions, /AUTOPILOT IS ON[\s\S]*plan is approved automatically/);
  const tools = s.state.log.filter(e => e.type === 'tool');
  assert.deepEqual(tools.map(e => [e.name, e.status, Boolean(e.autopilot)]), [
    ['Write', 'denied', false], ['ExitPlanMode', 'done', true], ['Write', 'done', false], ['Read', 'done', true], ['AskUserQuestion', 'done', true],
  ], 'plan mode still denies edits; only what needed the user is marked');
  assert.match(tools[1].output, /approved automatically/);
  assert.match(tools[4].output, /Autopilot is on and the user is away/);
  assert.equal(s.state.mode, 'acceptEdits');
  assert.ok(s.state.log.some(e => e.type === 'system' && /Autopilot approved the plan/.test(e.text)));
  assert.equal(fs.readFileSync(path.join(projects.projectDir('pilot'), 'a.txt'), 'utf8'), 'hi');
  assert.equal(model.sent.length, 6);
});

test('turning autopilot on answers what is already waiting, and /autopilot switches it', async () => {
  projects.create('waiting');
  const s = agent.getSession('waiting');
  assert.throws(() => agent.setOption(s, 'autopilot', 'yes'), /true or false/);
  const model = fakeModel(n => (n === 1 ? ['Read', { file_path: path.join(tmp, 'outside.txt') }] : null));
  try {
    await agent.submit('waiting', 'read it');
    for (let i = 0; i < 200 && !s.state.log.some(e => e.status === 'awaiting'); i++) await new Promise(r => setTimeout(r, 25));
    agent.setOption(s, 'autopilot', true);
    await idle(s);
  } finally { model.restore(); }
  const read = s.state.log.find(e => e.name === 'Read');
  assert.equal(read.status, 'done');
  assert.equal(read.autopilot, true);

  await agent.submit('waiting', '/autopilot off');
  assert.equal(s.state.autopilot, false);
  await agent.submit('waiting', '/autopilot maybe');
  assert.equal(s.state.log.at(-1).type, 'error');
  await agent.submit('waiting', '/autopilot on');
  assert.equal(s.state.autopilot, true);
  assert.match(s.state.log.at(-1).text, /Autopilot is on/);
});

test('an autopilot turn stops after 150 model requests', async () => {
  projects.create('looping');
  const s = agent.getSession('looping');
  agent.setOption(s, 'autopilot', true);
  const model = fakeModel(() => ['TodoWrite', { todos: [] }]);
  try {
    await agent.submit('looping', 'go forever');
    await idle(s, 60000);
  } finally { model.restore(); }
  assert.equal(model.sent.length, 150);
  assert.match(s.state.log.at(-1).text, /Autopilot stopped here after 150 model requests/);
  assert.equal(s.running, false);
});

test('any OpenAI-compatible server: its models are listed and a chat runs tools through it', async () => {
  const compat = await import('../server/compat.js');
  const bodies = [];
  const sse = (res, events) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(`${events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')}data: [DONE]\n\n`); };
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') {
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [
        { id: 'coder' }, { id: 'tiny', context_length: 32000, supported_parameters: ['tools'], pricing: { prompt: '0', completion: '0' } }, { id: 'chatty', supported_parameters: ['temperature'] },
      ] }));
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    bodies.push(JSON.parse(raw));
    if (bodies.length === 1) {
      return sse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'Read', arguments: '{"file_' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'path":"note.txt"}' } }] }, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 100, completion_tokens: 7, total_tokens: 107 } },
      ]);
    }
    sse(res, [{ choices: [{ delta: { reasoning_content: 'Looking.' } }] }, { choices: [{ delta: { content: 'It says ' } }] }, { choices: [{ delta: { content: 'hello.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 150, completion_tokens: 3 } }]);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ providers: { local: { name: 'Local', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, down: { baseURL: 'http://127.0.0.1:9/v1' } } }));
  try {
    const models = (await compat.compatModels()).filter(m => m.provider === 'local');
    assert.deepEqual(models.map(m => m.id), ['local:coder', 'local:tiny'], 'models known to lack tool calls are left out');
    assert.deepEqual([models[1].context, models[1].price, models[1].providerName], [32000, [0, 0], 'Local']);
    assert.equal(compat.providerOf('local:org/model:free'), 'local');
    assert.equal(compat.providerOf('claude-haiku-5-5'), null);
    assert.equal(compat.providerOf('unknown:thing'), null);

    projects.create('compat');
    const s = agent.getSession('compat');
    fs.writeFileSync(path.join(projects.projectDir('compat'), 'note.txt'), 'hello');
    agent.setOption(s, 'model', 'local:coder');
    await agent.submit('compat', 'what does note.txt say?');
    await idle(s);

    assert.equal(bodies.length, 2);
    const [first, second] = bodies;
    assert.equal(first.model, 'coder');
    assert.equal(first.stream, true);
    assert.equal(first.messages[0].role, 'system');
    assert.match(first.messages.at(-1).content, /what does note\.txt say\?/);
    assert.ok(first.tools.some(t => t.type === 'function' && t.function.name === 'Read' && t.function.parameters.properties.file_path));
    assert.ok(!first.tools.some(t => t.type !== 'function'), 'hosted tools like web search are left out');
    const [call, result] = second.messages.slice(-2);
    assert.deepEqual(call.tool_calls, [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"note.txt"}' } }]);
    assert.equal(result.role, 'tool');
    assert.equal(result.tool_call_id, 'c1');
    assert.match(result.content, /hello/);
    const log = s.state.log.filter(e => e.type !== 'user');
    assert.deepEqual(log.map(e => [e.type, e.name || e.text]), [['tool', 'Read'], ['reasoning', 'Looking.'], ['assistant', 'It says hello.']]);
    assert.equal(s.state.usage.input, 250);

    // A screenshot from a tool can't go in a tool message, so it follows the tool results.
    const msgs = compat.toMessages('sys', [
      { type: 'function_call', call_id: 'a', name: 'Read', arguments: '{}' }, { type: 'function_call', call_id: 'b', name: 'Read', arguments: '{}' },
      { type: 'function_call_output', call_id: 'a', output: [{ type: 'input_image', image_url: 'data:image/png;base64,AA' }] }, { type: 'function_call_output', call_id: 'b', output: 'ok' },
      { type: 'reasoning', summary: [] }, { role: 'user', content: 'next' },
    ]);
    assert.deepEqual(msgs.map(m => m.role), ['system', 'assistant', 'tool', 'tool', 'user', 'user']);
    assert.deepEqual(msgs[4].content, [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } }]);

    await assert.rejects(compat.callCompat({ model: 'down:x', instructions: '', input: [], tools: [] }, {}, AbortSignal.timeout(20000)), /Couldn't reach down at http:\/\/127\.0\.0\.1:9\/v1/);
    assert.doesNotThrow(() => agent.setOption(s, 'model', 'openrouter:meta-llama/llama-3.3-70b-instruct:free'));
  } finally {
    server.close();
    fs.writeFileSync(settingsFile, '{}');
  }
});

test('/create-agent asks for a description, then hands the model the format and where to write it', async () => {
  projects.create('maker');
  const s = agent.getSession('maker');
  await agent.submit('maker', '/create-agent');
  assert.equal(s.state.log.at(-1).type, 'error');
  const model = fakeModel();
  try {
    await agent.submit('maker', '/create-agent reviews SQL migrations');
    await idle(s);
  } finally { model.restore(); }
  const text = model.sent[0].input.find(i => i.role === 'user').content;
  assert.match(text, /reviews SQL migrations/);
  assert.ok(text.includes(path.join(projects.projectDir('maker'), '.nexus', 'agents')));
  assert.match(text, /tools: <comma-separated tool names/);
  assert.equal(s.state.log.find(e => e.type === 'user').text, '/create-agent reviews SQL migrations');
});

test('MCP server configs from the page are cleaned before they reach settings.json', () => {
  assert.deepEqual(mcp.cleanConfig({ url: ' https://example.com/mcp ', headers: { Authorization: 'Bearer x', 'Bad Header': 'y', Evil: 'a\r\nb' } }),
    { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer x' } });
  assert.deepEqual(mcp.cleanConfig({ command: 'npx', args: ['-y', 3], env: { API_KEY: 'k', '1BAD': 'v' } }), { command: 'npx', args: ['-y', '3'], env: { API_KEY: 'k' } });
  assert.throws(() => mcp.cleanConfig({ url: 'file:///etc/passwd' }), /https/);
  assert.throws(() => mcp.cleanConfig({}), /command or an http/);

  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ hooks: { Stop: [] }, mcpServers: { old: { command: 'nope-not-a-command' } } }));
  mcp.removeServer('old');
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), { hooks: { Stop: [] }, mcpServers: {} });
  assert.throws(() => mcp.addServer('bad name!', { command: 'x' }), /Server names/);
  fs.writeFileSync(settingsFile, '{ not json');
  assert.throws(() => mcp.addServer('ok', { command: 'x' }), /not valid JSON/);
  fs.writeFileSync(settingsFile, '{}');
});

test('Glob in a folder that does not exist says so, instead of blaming ripgrep', async () => {
  const { execTool } = await import('../server/tools.js');
  const cwd = path.join(tmp, 'globbing');
  fs.mkdirSync(cwd, { recursive: true });
  await assert.rejects(execTool('Glob', { pattern: '*.md', path: '.nexus/agents' }, { cwd }), /No such directory: .*agents/);
  assert.equal(await execTool('Glob', { pattern: '*.md' }, { cwd }), 'No files found.');
});

test('Windows runs npx through node, so no shell ever parses MCP arguments', () => {
  const nodeDir = path.join(tmp, 'nodejs');
  const cli = path.join(nodeDir, 'node_modules/npm/bin/npx-cli.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, '');
  const exe = path.join(nodeDir, 'node.exe');
  assert.deepEqual(mcp.launchCommand({ command: 'npx', args: ['-y', 'pkg & calc'] }, 'win32', exe), [exe, [cli, '-y', 'pkg & calc']]);
  assert.deepEqual(mcp.launchCommand({ command: 'npx', args: ['-y', 'pkg'] }, 'linux', exe), ['npx', ['-y', 'pkg']]);
  assert.deepEqual(mcp.launchCommand({ command: 'uvx', args: ['tool'] }, 'win32', exe), ['uvx', ['tool']]);
});

test('streamable HTTP MCP servers connect, keep their session, and answer over JSON or SSE', async () => {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const msg = JSON.parse(raw);
    seen.push({ method: msg.method, session: req.headers['mcp-session-id'], auth: req.headers.authorization });
    if (!('id' in msg)) return res.writeHead(202).end();
    const reply = result => ({ jsonrpc: '2.0', id: msg.id, result });
    if (msg.method === 'initialize') return res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' }).end(JSON.stringify(reply({ protocolVersion: '2025-06-18' })));
    if (msg.method === 'tools/list') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress' })}\n\nevent: message\ndata: ${JSON.stringify(reply({ tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }] }))}\n\n`);
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply({ content: [{ type: 'text', text: msg.params.arguments.text }] })));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    mcp.addServer('local', { url: `http://127.0.0.1:${server.address().port}/mcp`, headers: { Authorization: 'Bearer t' } });
    const tools = await mcp.toolDefs();
    assert.deepEqual(tools.map(t => t.name), ['mcp__local__echo']);
    assert.equal(await mcp.call('mcp__local__echo', { text: 'hi' }), 'hi');
    assert.deepEqual(seen.map(s => s.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
    assert.deepEqual(seen.slice(1).map(s => s.session), ['sess-1', 'sess-1', 'sess-1']);
    assert.ok(seen.every(s => s.auth === 'Bearer t'));
    assert.deepEqual(mcp.status().map(s => [s.name, s.status, s.remote]), [['local', 'connected', true]]);
  } finally {
    mcp.removeServer('local');
    server.close();
  }
});

test('marketplace: catalog search, the ponytail agents, and parsing listings', async () => {
  const picks = await market.search('agents', 'nexus', 'ponytail');
  assert.deepEqual(picks.map(p => p.name), ['ponytail', 'ponytail-review', 'ponytail-audit', 'ponytail-debt']);
  const all = await market.search('agents', 'nexus', '');
  assert.ok(all.length >= 100);
  assert.equal(all[0].name, 'ponytail', 'featured first');
  const pony = await market.item('agents', 'nexus', 'ponytail');
  assert.equal(pony.agent.tools, null);
  assert.match(pony.agent.prompt, /Adapted from ponytail by Dietrich Gebert \(MIT\)/);
  const hf = await market.item('mcp', 'nexus', 'huggingface');
  assert.deepEqual(hf.server.config, { url: 'https://huggingface.co/mcp' });
  await assert.rejects(market.search('agents', 'elsewhere', ''), /Unknown marketplace source/);

  const card = '<a href="/mcp-servers/github-mcp-server" class="group"><div><img src="x" alt="github"/><h3>github-mcp-server</h3><p>by <!-- -->github<span> · <!-- -->Version Control</span></p></div><p>GitHub&#x27;s official MCP Server</p><div><span data-slot="badge">Go</span><span><svg><path/></svg>15,738</span></div></a>';
  assert.deepEqual(market.parseCards(card + card, 'mcp'), [{
    source: 'aiagentslist', kind: 'mcp', id: 'github-mcp-server', name: 'github-mcp-server', author: 'github', category: 'Version Control',
    description: "GitHub's official MCP Server", stats: '★ 15,738', url: 'https://aiagentslist.com/mcp-servers/github-mcp-server', installable: true,
  }]);
  const page = '<pre>{\n  &quot;mcpServers&quot;: {\n    &quot;playwright&quot;: { &quot;command&quot;: &quot;npx&quot;, &quot;args&quot;: [&quot;@playwright/mcp@latest&quot;] }\n  }\n}</pre>';
  assert.deepEqual(market.configFrom(page), { name: 'playwright', conf: { command: 'npx', args: ['@playwright/mcp@latest'] } });
  assert.deepEqual(market.splitCommand('npx @playwright/mcp@latest --port "8 1"'), ['npx', '-y', '@playwright/mcp@latest', '--port', '8 1']);
});

test('Hugging Face Spaces connect natively on Gradio 6 and through mcp-remote before that', async () => {
  const realFetch = globalThis.fetch;
  const space = sdk => ({ id: 'me/demo', author: 'me', likes: 1234, subdomain: 'me-demo', runtime: { stage: 'RUNNING' }, cardData: { title: 'Demo', emoji: '🧪', sdk_version: sdk, short_description: 'Makes demos' } });
  try {
    globalThis.fetch = async () => Response.json(space('6.2.0'));
    const modern = await market.item('mcp', 'huggingface', 'me/demo');
    assert.deepEqual(modern.server.config, { url: 'https://me-demo.hf.space/gradio_api/mcp/' });
    assert.equal(modern.stats, '♥ 1.2k');
    globalThis.fetch = async () => Response.json({ ...space('5.35.0'), id: 'me/old' });
    const old = await market.item('mcp', 'huggingface', 'me/old');
    assert.deepEqual(old.server.config, { command: 'npx', args: ['-y', 'mcp-remote', 'https://me-demo.hf.space/gradio_api/mcp/sse'] });
    await assert.rejects(market.item('mcp', 'huggingface', '../../etc'), /Bad Space id/);
  } finally { globalThis.fetch = realFetch; }
});
