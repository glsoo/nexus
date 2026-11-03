import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pty from 'node-pty';
import { WebSocket, WebSocketServer } from 'ws';
import * as agent from './agent.js';
import { anthropicModels } from './anthropic.js';
import { compatModels } from './compat.js';
import * as auth from './auth.js';
import { agentDefs, commands, deleteAgentDef, removeSkill, saveAgentDef, skills, skillScope } from './extensions.js';
import * as market from './market.js';
import * as mcp from './mcp.js';
import * as projects from './projects.js';
import { findFiles } from './tools.js';
import { DEFAULT_BASE, globalPrompts, savePrompts } from './prompts.js';
import * as push from './push.js';
import { apiKey, childEnv, isInside, KEY_NAMES, keysPath, NEXUS_HOME, presentSocket, readJson, readSettings, saveKey, settingsPath, shellCommand, writeAtomic } from './util.js';

const PORT = Number(process.env.NEXUS_PORT) || 7711;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
// Changes only with the page's code, so open tabs reload only when they'd otherwise be out of date.
const BUILD = createHash('sha1').update(['index.html', 'app.js', 'style.css'].map(f => fs.readFileSync(path.join(PUBLIC, f), 'utf8')).join('')).digest('hex').slice(0, 12);
const NM = path.join(ROOT, 'node_modules');
const VENDOR = {
  'marked.js': 'marked/lib/marked.umd.js',
  'purify.js': 'dompurify/dist/purify.min.js',
  'xterm.js': '@xterm/xterm/lib/xterm.js',
  'xterm.css': '@xterm/xterm/css/xterm.css',
  'fit.js': '@xterm/addon-fit/lib/addon-fit.js',
  'hljs.js': '@highlightjs/cdn-assets/highlight.min.js',
  'hljs.css': '@highlightjs/cdn-assets/styles/github-dark.min.css',
  'inter.woff2': '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  'mono.woff2': '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const SECURITY = {
  'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
};

// No allow-same-origin: presented pages get an opaque origin, so they can't reach the panel's API, cookie or terminal.
const PRESENT_CSP = 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads';

const fail = (status, message) => Object.assign(new Error(message), { status });
const cookieToken = req => /(?:^|;\s*)nexus_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
const clientIp = req => req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
const originOk = (req, required) => {
  const { origin } = req.headers;
  if (!origin) return !required;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
};
function setCookie(req, res, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('set-cookie', `nexus_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}

function body(req, max = 40_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > max) { reject(fail(413, 'Request too large.')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { reject(fail(400, 'Invalid JSON.')); }
    });
    req.on('error', reject);
  });
}

function need(name) {
  if (!projects.exists(name)) throw fail(404, 'Project not found.');
  return name;
}
// A path in the project's folder, or in a folder added to its chat (those are given in full).
function projectPath(name, rel = '.') {
  const dir = projects.projectDir(need(name)), target = path.resolve(dir, String(rel));
  if (![dir, ...agent.folders(name).dirs].some(d => isInside(d, target))) throw fail(403, 'That path is outside the project.');
  return target;
}

// ---- REST ----
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

route('GET', '/api/projects', () => projects.list().map(p => ({ ...p, busy: agent.isBusy(p.name) })));
route('GET', '/api/folders', ({ q }) => projects.folders(q.get('path')));
route('POST', '/api/projects/open', async ({ req }) => ({ name: projects.open((await body(req)).path) }));
route('GET', '/api/search', ({ q }) => agent.search(q.get('q') || ''));
route('POST', '/api/projects', async ({ req }) => {
  const name = projects.create((await body(req)).name);
  broadcast({ t: 'projects' });
  return { name };
});
route('POST', '/api/projects/clone', async ({ req }) => {
  const name = await projects.clone((await body(req)).url);
  broadcast({ t: 'projects' });
  return { name };
});
route('GET', '/api/projects/:name/folders', ({ p }) => agent.folders(need(p.name)));
route('POST', '/api/projects/:name/folders', async ({ req, p }) => agent.addFolder(need(p.name), (await body(req)).path));
route('DELETE', '/api/projects/:name/folders', async ({ req, p }) => agent.removeFolder(need(p.name), String((await body(req)).path || '')));
route('POST', '/api/projects/:name/rename', async ({ req, p }) => {
  const { to } = await body(req);
  agent.renameProject(need(p.name), to);
  return { name: to };
});
route('DELETE', '/api/projects/:name', ({ p }) => {
  agent.trashProject(need(p.name));
  broadcast({ t: 'projects' });
  return {};
});

route('GET', '/api/projects/:name/tree', ({ p, q }) => {
  const dir = projectPath(p.name, q.get('path') || '.');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => !['.nexus', '.git'].includes(d.name))
    .map(d => ({ name: d.name, dir: d.isDirectory() }))
    .sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name));
});
route('GET', '/api/projects/:name/files', ({ p, q }) => findFiles(projectPath(p.name), q.get('q') || '', agent.folders(p.name).dirs));
route('GET', '/api/projects/:name/file', ({ p, q }) => {
  const file = projectPath(p.name, q.get('path'));
  const { size } = fs.statSync(file);
  if (size > 2_000_000) throw fail(413, `This file is ${size} bytes, too large for the editor.`);
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8000).includes(0)) throw fail(415, 'This is a binary file.');
  return { content: buf.toString('utf8') };
});
route('PUT', '/api/projects/:name/file', async ({ req, p }) => {
  const { path: rel, content } = await body(req);
  const file = projectPath(p.name, rel);
  if ([projects.projectDir(p.name), ...agent.folders(p.name).dirs].some(d => isInside(path.join(d, '.nexus'), file))) throw fail(403, '.nexus is managed by Nexus.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(content));
  return {};
});
route('GET', '/api/projects/:name/changes', ({ p }) => agent.changes(need(p.name)));
route('POST', '/api/projects/:name/changes/keep', async ({ req, p }) => { agent.keepChanges(need(p.name), (await body(req)).files); return {}; });
route('POST', '/api/projects/:name/changes/undo', async ({ req, p }) => {
  const raw = String((await body(req)).path || '');
  if (!raw) throw fail(400, 'That file cannot be undone.');
  await agent.undoFile(p.name, projectPath(p.name, raw));
  return {};
});
route('GET', '/api/projects/:name/log', ({ p, q }) => agent.olderEntries(need(p.name), q.get('before') || ''));
route('GET', '/api/projects/:name/export', ({ p }) => ({ markdown: agent.exportMarkdown(need(p.name)) }));
route('POST', '/api/projects/:name/rewind', async ({ req, p }) => {
  const { id, files, conversation } = await body(req);
  return agent.rewind(need(p.name), id, { files, conversation });
});
route('GET', '/api/projects/:name/meta', ({ p }) => {
  const cwd = projects.projectDir(need(p.name));
  return {
    commands: commands(cwd).map(({ name, description }) => ({ name, description })),
    skills: skills(cwd, true).map(({ name, description, argumentHint, dir, off }) => ({ name, description, argumentHint, off, scope: skillScope(cwd, dir) })),
    agents: agentDefs(cwd).map(({ prompt, file, ...a }) => ({ ...a, prompt })),
  };
});
route('POST', '/api/projects/:name/agent-defs', async ({ req, p }) => {
  const { scope, ...def } = await body(req);
  saveAgentDef(projects.projectDir(need(p.name)), scope, def);
  return {};
});
route('DELETE', '/api/projects/:name/agent-defs/:def', ({ p }) => {
  deleteAgentDef(projects.projectDir(need(p.name)), p.def);
  return {};
});

// System prompts and injected text: chat and project here, global also at /api/prompts for the Settings page.
route('GET', '/api/projects/:name/prompts', ({ p }) => ({ ...agent.getPrompts(need(p.name)), defaultBase: DEFAULT_BASE }));
route('PUT', '/api/projects/:name/prompts', async ({ req, p }) => {
  const { scope, system, inject } = await body(req);
  agent.setPrompts(need(p.name), scope, { system, inject });
  return {};
});
route('GET', '/api/projects/:name/prompts/preview', ({ p }) => ({ text: agent.previewPrompt(need(p.name)) }));
route('GET', '/api/prompts', () => ({ global: globalPrompts(), defaultBase: DEFAULT_BASE }));
route('PUT', '/api/prompts', async ({ req }) => {
  const { system, inject } = await body(req);
  savePrompts('global', { system, inject });
  return {};
});

route('GET', '/api/market', async ({ q }) => {
  const kind = ['mcp', 'skills'].includes(q.get('kind')) ? q.get('kind') : 'agents';
  return { items: await market.search(kind, q.get('source') || 'nexus', q.get('q')), sources: market.SOURCES[kind], links: market.LINKS[kind] };
});
route('GET', '/api/market/item', ({ q }) => market.item(['mcp', 'skills'].includes(q.get('kind')) ? q.get('kind') : 'agents', q.get('source') || 'nexus', q.get('id') || ''));
// Skills go to ~/.nexus/skills for every project, or this project's .nexus/skills.
route('POST', '/api/projects/:name/skills', async ({ req, p }) => {
  const { repo, dir = '', scope } = await body(req);
  const root = scope === 'project' ? path.join(projects.projectDir(need(p.name)), '.nexus') : NEXUS_HOME;
  return { name: await market.installSkill(String(repo || ''), String(dir), root) };
});
route('DELETE', '/api/projects/:name/skills/:skill', ({ p }) => { removeSkill(projects.projectDir(need(p.name)), decodeURIComponent(p.skill)); return {}; });
// One skill's instructions, and the GitHub folder it was installed from, which Update downloads again.
route('GET', '/api/projects/:name/skills/:skill', ({ p }) => {
  const k = skills(projects.projectDir(need(p.name)), true).find(x => x.name === decodeURIComponent(p.skill));
  if (!k) throw fail(404, 'No such skill.');
  return { body: k.body, source: readJson(path.join(k.dir, '.nexus-source.json'), null) };
});
// Turning a skill off is by name and applies in every project, like the rest of settings.json.
route('PUT', '/api/skills/:skill', async ({ req, p }) => {
  const name = decodeURIComponent(p.skill), { off } = await body(req);
  let settings = {};
  // A settings.json that doesn't parse is left alone rather than replaced, so nothing in it is lost.
  try { settings = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) || {}; } catch (err) { if (err.code !== 'ENOENT') throw fail(400, `Fix ~/.nexus/settings.json first: ${err.message}`); }
  const list = (Array.isArray(settings.skillsOff) ? settings.skillsOff : []).filter(n => n !== name);
  writeAtomic(settingsPath(), JSON.stringify({ ...settings, skillsOff: off ? [...list, name] : list }, null, 2) + '\n');
  return {};
});
route('POST', '/api/mcp-servers', async ({ req }) => {
  const { name, config } = await body(req);
  mcp.addServer(name, config);
  return { mcp: mcp.status() };
});
route('DELETE', '/api/mcp-servers/:server', ({ p }) => {
  mcp.removeServer(p.server);
  return { mcp: mcp.status() };
});

const shellInfo = ({ proc, output, read, ...s }) => s;
route('GET', '/api/agents', () => ({ agents: agent.listAgents(), shells: [...agent.shells.values()].map(shellInfo).reverse(), schedules: agent.schedules() }));
route('DELETE', '/api/schedules/:id', ({ p }) => { agent.removeSchedule(p.id); return {}; });
route('GET', '/api/agents/:id', ({ p }) => {
  const a = agent.getAgent(p.id);
  if (!a) throw fail(404, 'Agent not found.');
  const { controller, ...rest } = a;
  return rest;
});
route('GET', '/api/push/key', () => ({ key: push.publicKey() }));
route('POST', '/api/push/subscribe', async ({ req }) => { push.subscribe(await body(req), auth.sessionKey(cookieToken(req))); return {}; });
route('POST', '/api/push/unsubscribe', async ({ req }) => { push.unsubscribe(String((await body(req)).endpoint || '')); return {}; });
route('POST', '/api/agents/:id/stop', ({ p }) => { agent.stopAgent(p.id); return {}; });
route('POST', '/api/agents', async ({ req }) => {
  const { project, type, description, prompt, isolation } = await body(req);
  if (!prompt) throw fail(400, 'A prompt is required.');
  await agent.runSubagent(agent.getSession(need(project)), { subagent_type: type, description, prompt, run_in_background: true, notify: false, isolation: isolation === 'worktree' ? 'worktree' : undefined });
  return {};
});
route('GET', '/api/shells/:id', ({ p }) => {
  const s = agent.shells.get(p.id);
  if (!s) throw fail(404, 'Shell not found.');
  return { output: s.output.slice(-200000), status: s.status };
});
route('POST', '/api/shells/:id/kill', ({ p }) => {
  const s = agent.shells.get(p.id);
  if (s) agent.killGroup(s.proc);
  return {};
});

route('GET', '/api/spending', () => agent.spending());
// API keys pasted into Settings. Only whether each one is set goes back to the page, never the key.
route('GET', '/api/keys', () => {
  const saved = readJson(keysPath(), {});
  return KEY_NAMES.map(name => ({ name, env: Boolean(process.env[name]), saved: Boolean(saved[name]) }));
});
route('PUT', '/api/keys/:key', async ({ req, p }) => { saveKey(p.key, (await body(req)).value); return {}; });
route('GET', '/api/settings', () => ({
  text: fs.existsSync(settingsPath()) ? fs.readFileSync(settingsPath(), 'utf8') : '{\n  "hooks": {},\n  "mcpServers": {}\n}\n',
  mcp: mcp.status(),
}));
route('PUT', '/api/settings', async ({ req }) => {
  const { text } = await body(req);
  try { JSON.parse(text); } catch (err) { throw fail(400, `Not valid JSON: ${err.message}`); }
  writeAtomic(settingsPath(), text);
  return {};
});

const UPDATE_MS = 6 * 3600_000;
const AUTO_UPDATE = process.platform !== 'win32' && process.env.NEXUS_AUTO_UPDATE !== '0';
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
// Waits while anything is running, because a restart would interrupt it and a merge could catch the bot mid-edit.
function runUpdate() {
  if (process.platform === 'win32') throw fail(409, 'Use Git to update this Windows checkout, then restart Nexus from its launcher.');
  if (projects.list().some(p => agent.isBusy(p.name))) return false;
  spawn(path.join(ROOT, 'scripts/update.sh'), { cwd: ROOT, env: childEnv(), detached: true, stdio: 'ignore' }).unref();
  return true;
}
if (AUTO_UPDATE) setInterval(runUpdate, UPDATE_MS).unref();
route('GET', '/api/version', () => {
  const count = range => { try { return Number(git('rev-list', '--count', range)); } catch { return 0; } };
  let status = '';
  try { status = fs.readFileSync(path.join(ROOT, 'data/update-status.txt'), 'utf8').trim(); } catch { /* no update has run yet */ }
  return { version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, commit: git('rev-parse', '--short', 'HEAD'),
    local: count('origin/main..HEAD'), behind: count('HEAD..origin/main'), status, auto: AUTO_UPDATE };
});
route('POST', '/api/update', () => {
  if (!runUpdate()) throw fail(409, 'Something is running. Try again when it finishes.');
  return {};
});

route('POST', '/api/self-improve', async ({ req }) => {
  const { text } = await body(req);
  if (!String(text ?? '').trim()) throw fail(400, 'Say what to add or change.');
  const name = agent.selfProject();
  await agent.submit(name, String(text));
  return { name };
});

let modelCache = { at: 0, list: [] };
async function openaiModels() {
  if (!apiKey('OPENAI_API_KEY')) return [];
  if (Date.now() - modelCache.at > 3600_000) {
    const res = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${apiKey('OPENAI_API_KEY')}` } });
    if (!res.ok) throw fail(502, `OpenAI returned ${res.status} when listing models.`);
    const list = (await res.json()).data.map(m => m.id)
      .filter(id => /^(gpt-[4-9]|o\d)/.test(id) && !/audio|realtime|image|tts|transcribe|search|embed|moderation|-\d{4}-\d\d-\d\d$/.test(id))
      .sort((a, b) => a.startsWith('o') - b.startsWith('o') || b.localeCompare(a, undefined, { numeric: true }))
      .map(id => ({ id, name: id.replace(/^gpt/, 'GPT').replace(/-([a-z])/g, (_, c) => ` ${c.toUpperCase()}`), provider: 'openai', providerName: 'OpenAI', efforts: agent.supportsReasoning(id) ? ['low', 'medium', 'high', 'xhigh'] : [] }));
    modelCache = { at: Date.now(), list };
  }
  return modelCache.list;
}
// One provider being down must not hide the others' models.
route('GET', '/api/models', async () => {
  const results = await Promise.allSettled([anthropicModels(), openaiModels(), compatModels()]);
  const list = results.flatMap(r => r.value || []);
  if (!list.length) throw results.find(r => r.reason)?.reason || fail(502, 'No models available.');
  return list;
});

// ---- HTTP ----
function serveStatic(res, file, immutable) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=86400' : 'no-cache' });
    res.end(data);
  });
}

async function api(req, res, url) {
  if (url.pathname === '/api/login' && req.method === 'POST') {
    const ip = clientIp(req);
    if (auth.loginBlocked(ip)) throw fail(429, 'Too many failed attempts. Try again later.');
    // Counted before anything is awaited, so guesses sent in parallel can't all pass the check above.
    const attempt = auth.recordFail(ip);
    const { user, pass } = await body(req, 10_000);
    if (!await auth.verifyPassword(user ?? '', pass ?? '')) throw fail(401, 'Incorrect username or password.');
    auth.forgive(attempt);
    setCookie(req, res, auth.createSession(), 30 * 24 * 3600);
    return { ok: true };
  }
  const token = cookieToken(req);
  if (!auth.validSession(token)) throw fail(401, 'Sign in first.');
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    auth.endSession(token);
    setCookie(req, res, '', 0);
    for (const c of [...wss.clients, ...termWss.clients]) if (c.token === token) c.close();
    return {};
  }
  if (url.pathname === '/api/me') return { build: BUILD, user: process.env.NEXUS_USER, defaultModel: projects.DEFAULT_MODEL, autoCompact: readSettings().autoCompactTokens || 300000 };
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    const p = Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
    return await r.fn({ req, res, p, q: url.searchParams });
  }
  throw fail(404, 'Not found.');
}

// /present/<id>/ proxies to that presentation's own process (scripts/present.js). The secret id is the only credential.
function present(req, res, url) {
  const m = /^\/present\/([\w-]{16})(\/.*)?$/.exec(url.pathname);
  const gone = () => {
    if (res.headersSent) res.destroy();
    else res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('This link has ended.');
  };
  if (!m) return gone();
  if (!m[2]) return res.writeHead(308, { location: `${url.pathname}/${url.search}` }).end();
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
  const { range } = req.headers;
  const up = http.request({
    socketPath: presentSocket(m[1]), method: req.method, path: m[2] + url.search,
    headers: { host: 'present', ...(range ? { range } : {}) },
  }, r => {
    // A browser's PDF viewer won't run inside a sandbox, and a PDF can't script the page's origin anyway.
    if (r.headers['content-type'] === 'application/pdf') res.removeHeader('content-security-policy');
    else res.setHeader('content-security-policy', PRESENT_CSP);
    res.writeHead(r.statusCode, { ...r.headers, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    r.pipe(res);
  });
  up.on('error', gone);
  res.on('close', () => up.destroy());
  up.end();
}

// Anything a handler throws ends that request, never the server.
const server = http.createServer((req, res) => handle(req, res).catch(err => {
  console.error(req.method, req.url, err);
  if (!res.headersSent) res.writeHead(500);
  res.end();
}));
async function handle(req, res) {
  for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400).end(); return; }
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('cache-control', 'no-store');
    try {
      if (req.method !== 'GET' && !originOk(req)) throw fail(403, 'Cross-origin request refused.');
      const result = await api(req, res, url);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (err) {
      if (!err.status) console.error(req.method, url.pathname, err);
      const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  if (url.pathname.startsWith('/present/')) return present(req, res, url);
  if (url.pathname.startsWith('/vendor/')) {
    const file = Object.hasOwn(VENDOR, url.pathname.slice(8)) ? VENDOR[url.pathname.slice(8)] : null; // not "constructor"
    if (!file) { res.writeHead(404).end(); return; }
    serveStatic(res, path.join(NM, file), true);
    return;
  }
  const rel = { '/app.js': 'app.js', '/sw.js': 'sw.js', '/hljs-worker.js': 'hljs-worker.js', '/style.css': 'style.css', '/icon.svg': 'icon.svg', '/icon-180.png': 'icon-180.png', '/manifest.webmanifest': 'manifest.webmanifest' }[url.pathname] || 'index.html';
  if (rel !== 'index.html') return serveStatic(res, path.join(PUBLIC, rel));
  // Cloudflare gives static files a 4h browser TTL whatever we send, so each build needs its own URLs.
  const html = fs.readFileSync(path.join(PUBLIC, rel), 'utf8').replace(/"\/(app\.js|style\.css)"/g, `"/$1?v=${BUILD}"`);
  res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' }).end(html);
}

// ---- WebSockets: /ws for the conversation, /term for the terminal ----
const wss = new WebSocketServer({ noServer: true, maxPayload: 40_000_000 });
const termWss = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
const sendTo = (ws, msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
const broadcast = msg => wss.clients.forEach(ws => sendTo(ws, msg));

server.on('upgrade', (req, socket, head) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { socket.destroy(); return; }
  const token = cookieToken(req);
  const target = { '/ws': wss, '/term': termWss }[url.pathname];
  if (!target || !originOk(req, true) || !auth.validSession(token)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  target.handleUpgrade(req, socket, head, ws => {
    ws.token = token;
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    target.emit('connection', ws, url);
  });
});

// Keeps Cloudflare from closing idle sockets, and drops dead ones.
setInterval(() => {
  for (const ws of [...wss.clients, ...termWss.clients]) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
    if (wss.clients.has(ws)) sendTo(ws, { t: 'hb' }); // lets the page notice a dead connection
  }
}, 15000).unref();

wss.on('connection', ws => {
  ws.on('message', async raw => {
    if (!auth.validSession(ws.token)) { ws.close(); return; }
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    try {
      if (m.t === 'open') {
        need(m.name);
        ws.project = m.name;
        sendTo(ws, { t: 'state', state: agent.publicState(agent.getSession(m.name)) });
        return;
      }
      if (!ws.project) return;
      if (m.t === 'send') await agent.submit(ws.project, String(m.text ?? ''), m.images);
      else if (m.t === 'answer') agent.answer(ws.project, m.id, m.value);
      else if (m.t === 'interrupt') agent.interrupt(ws.project);
      else if (m.t === 'option') agent.setOption(agent.getSession(ws.project), m.key, m.value);
    } catch (err) {
      sendTo(ws, { t: 'toast', text: err.message });
    }
  });
});

// Subscribed browsers get a push when a chat finishes or waits on the user, even with Nexus closed.
const busy = new Set(), pinged = new WeakSet();
const ping = (title, body, project) => push.notify({ title, body, project }, auth.liveSessionKey).catch(err => console.error('Web Push:', err.message));
const asks = { AskUserQuestion: 'has a question for you', ExitPlanMode: 'has a plan for you to approve' };
agent.hub.on('project', (name, ev) => {
  for (const ws of wss.clients) if (ws.project === name) sendTo(ws, ev);
  if (ev.t === 'status') broadcast({ t: 'projects' });
  if (ev.t === 'status' && ev.running) busy.add(name);
  else if (ev.t === 'status' && busy.delete(name)) {
    const reply = agent.getSession(name).state.log.findLast(e => e.type === 'assistant')?.text || '';
    ping(`${name} finished`, reply.replace(/\s+/g, ' ').slice(0, 140) || 'The agent is done.', name);
  } else if (ev.t === 'entry' && ev.entry.status === 'awaiting' && !pinged.has(ev.entry)) {
    pinged.add(ev.entry);
    ping(`${name} needs you`, `The agent ${asks[ev.entry.name] || `wants to run ${ev.entry.name}`}.`, name);
  }
});
agent.hub.on('agent', ({ agent: a }) => broadcast({ t: 'agent', agent: a }));
agent.hub.on('renamed', (from, to) => {
  for (const ws of wss.clients) if (ws.project === from) ws.project = to;
  broadcast({ t: 'renamed', from, to });
});

// ponytail: one shell per open terminal socket, closed with it; run tmux inside if it must outlive the tab.
termWss.on('connection', (ws, url) => {
  let term;
  try {
    term = pty.spawn(shellCommand(), [], {
      name: 'xterm-256color', cwd: projects.projectDir(need(url.searchParams.get('project'))), env: childEnv(),
      cols: Number(url.searchParams.get('cols')) || 80, rows: Number(url.searchParams.get('rows')) || 24,
    });
  } catch (err) {
    ws.close(1011, err.message.slice(0, 100));
    return;
  }
  term.onData(d => { if (ws.readyState === WebSocket.OPEN) ws.send(d); });
  term.onExit(() => ws.close());
  ws.on('close', () => term.kill());
  ws.on('message', raw => {
    if (!auth.validSession(ws.token)) { ws.close(); return; }
    try {
      const m = JSON.parse(raw);
      if (m.i !== undefined) term.write(m.i);
      else if (m.cols > 0 && m.rows > 0) term.resize(m.cols, m.rows);
    } catch { /* ignore malformed frames */ }
  });
});

mcp.reload();
fs.watchFile(settingsPath(), { interval: 2000 }, () => mcp.reload());
agent.reportFailedDeploy();
agent.resumeAfterRestart();
agent.startSchedules();
agent.startWatches();
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(); // under socket activation, new connections wait in the kernel for the next process
  for (const ws of [...wss.clients, ...termWss.clients]) ws.close(1012, 'restarting');
  for (const s of agent.shells.values()) agent.killGroup(s.proc);
  await Promise.race([agent.stopForRestart(), new Promise(r => setTimeout(r, 5000))]).catch(console.error);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
server.listen(process.env.LISTEN_FDS ? { fd: 3 } : { port: PORT, host: '127.0.0.1' }, () => console.log(`Nexus on http://127.0.0.1:${PORT}`));
