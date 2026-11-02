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

// A model that answers "ok" and records what it was sent.
function fakeModel() {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('api.openai.com/v1/responses')) return realFetch(url, init);
    sent.push(JSON.parse(init.body));
    const done = { type: 'response.completed', response: { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }], usage: { input_tokens: 1, output_tokens: 1 } } };
    return new Response(`data: ${JSON.stringify(done)}\n\n`);
  };
  return { sent, restore: () => { globalThis.fetch = realFetch; } };
}
const idle = async s => { for (let i = 0; i < 200 && (s.running || s.queue.length); i++) await new Promise(r => setTimeout(r, 25)); };

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
  const user = req.input.find(i => i.role === 'user');
  assert.match(user.content, /^look at main\.js\n\n---\nStanding instructions from the user, added to every message:\nCite file paths\.$/);
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
