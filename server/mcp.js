import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { childEnv, readSettings, settingsPath, writeAtomic } from './util.js';

// Minimal MCP client, configured under "mcpServers" in ~/.nexus/settings.json: stdio servers
// ({ command, args, env }, newline-delimited JSON-RPC) and streamable HTTP ones ({ url, headers }).
// ponytail: HTTP servers get no OAuth flow; ones that need a token take it as a header.
const servers = new Map();
const PROTOCOL = '2025-06-18';
const CLIENT = { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'nexus', version: '1.0.0' } };

// Windows can only start npx.cmd through a shell, which would also parse the arguments, so run npm's own script with node.
// ponytail: other .cmd launchers (pnpm dlx, yarn dlx) still fail on Windows; use npx, uvx or a full .exe path there.
export function launchCommand(conf, platform = process.platform, execPath = process.execPath) {
  const args = conf.args || [];
  if (platform === 'win32' && /^npx(\.cmd)?$/i.test(conf.command)) {
    const cli = path.join(path.dirname(execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    if (fs.existsSync(cli)) return [execPath, [cli, ...args]];
  }
  return [conf.command, args];
}

class Server {
  constructor(name, conf) {
    this.name = name; this.tools = []; this.status = 'starting'; this.error = null;
    this.nextId = 1; this.waiting = new Map(); this.buf = '';
    const [command, args] = launchCommand(conf);
    this.proc = spawn(command, args, { env: { ...childEnv(), ...conf.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.proc.on('error', err => this.fail(err.message));
    this.proc.on('exit', () => this.fail('Server exited'));
    this.proc.stdin.on('error', () => {});
    this.proc.stdout.on('data', d => this.onData(d));
    this.ready = this.init().catch(err => this.fail(err.message));
  }

  fail(message) {
    this.status = 'error'; this.error = message;
    for (const { reject } of this.waiting.values()) reject(new Error(message));
    this.waiting.clear();
  }

  close() { this.proc.kill(); }

  onData(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const w = this.waiting.get(msg.id);
      if (!w) continue;
      this.waiting.delete(msg.id);
      if (msg.error) w.reject(new Error(msg.error.message || 'MCP error')); else w.resolve(msg.result);
    }
  }

  request(method, params, timeoutMs = 120000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`MCP ${method} timed out`)); }, timeoutMs);
      this.waiting.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async init() {
    await this.request('initialize', CLIENT, 30000);
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    this.tools = (await this.request('tools/list', {}, 30000)).tools || [];
    this.status = 'connected';
  }
}

// Streamable HTTP: every message is a POST; the answer comes back as JSON or as an SSE stream.
class HttpServer {
  constructor(name, conf) {
    this.name = name; this.url = conf.url; this.headers = conf.headers || {};
    this.tools = []; this.status = 'starting'; this.error = null; this.nextId = 1; this.session = null;
    this.ready = this.init().catch(err => this.fail(err.message));
  }

  fail(message) { this.status = 'error'; this.error = message; }

  close() {
    if (this.session) fetch(this.url, { method: 'DELETE', headers: { ...this.headers, 'mcp-session-id': this.session } }).catch(() => {});
  }

  async post(message, timeoutMs) {
    const res = await fetch(this.url, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify(message),
      headers: { ...this.headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL, ...(this.session ? { 'mcp-session-id': this.session } : {}) },
    });
    this.session = res.headers.get('mcp-session-id') || this.session;
    return res;
  }

  async request(method, params, timeoutMs = 120000, retried = false) {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: '2.0', id, method, params }, timeoutMs);
    // An expired session answers 404; start a new one once.
    if (res.status === 404 && this.session && !retried && method !== 'initialize') {
      await res.body?.cancel();
      this.session = null;
      await this.init();
      return this.request(method, params, timeoutMs, true);
    }
    if (!res.ok) { await res.body?.cancel(); throw new Error(`MCP ${method}: HTTP ${res.status}`); }
    const msg = (res.headers.get('content-type') || '').includes('text/event-stream') ? await answerFrom(res.body, id) : await res.json();
    if (!msg) throw new Error(`MCP ${method}: the server sent no answer`);
    if (msg.error) throw new Error(msg.error.message || 'MCP error');
    return msg.result;
  }

  async init() {
    await this.request('initialize', CLIENT, 30000);
    const res = await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, 30000);
    await res.body?.cancel();
    this.tools = (await this.request('tools/list', {}, 30000)).tools || [];
    this.status = 'connected';
  }
}

async function answerFrom(body, id) {
  let buf = '';
  for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      try {
        const msg = JSON.parse(line.slice(5));
        if (msg.id === id) return msg;
      } catch { /* not JSON: a keepalive */ }
    }
  }
  return null;
}

// Only servers whose settings changed restart, so saving a hook or adding a server leaves the rest connected.
export function reload() {
  const wanted = readSettings().mcpServers || {};
  for (const [name, s] of servers) {
    if (JSON.stringify(wanted[name]) !== s.key) { s.close(); servers.delete(name); }
  }
  for (const [name, conf] of Object.entries(wanted)) {
    if (servers.has(name)) continue;
    const s = conf?.url ? new HttpServer(name, conf) : conf?.command ? new Server(name, conf) : null;
    if (s) { s.key = JSON.stringify(conf); servers.set(name, s); }
  }
}

const toolName = (server, tool) => `mcp__${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

export async function toolDefs() {
  // A slow or sleeping server shouldn't hold up the turn; its tools join a later one.
  await Promise.race([Promise.all([...servers.values()].map(s => s.ready)), new Promise(r => setTimeout(r, 15000).unref())]);
  return [...servers.values()].filter(s => s.status === 'connected').flatMap(s => s.tools.map(t => ({
    type: 'function', name: toolName(s.name, t.name), description: t.description || '', strict: false,
    parameters: t.inputSchema || { type: 'object', properties: {} },
  })));
}

export async function call(name, args) {
  for (const s of servers.values()) for (const t of s.tools) {
    if (toolName(s.name, t.name) !== name) continue;
    const res = await s.request('tools/call', { name: t.name, arguments: args });
    const text = (res.content || []).map(c => c.type === 'text' ? c.text : `[${c.type} content]`).join('\n');
    return res.isError ? `MCP tool error: ${text}` : text;
  }
  throw new Error(`Unknown MCP tool ${name}`);
}

export const status = () => [...servers.values()].map(s => ({ name: s.name, status: s.status, error: s.error, tools: s.tools.map(t => t.name), remote: s instanceof HttpServer }));

// ---- adding and removing servers from the page ----
const fail = (status, message) => Object.assign(new Error(message), { status });
const SERVER_NAME = /^[\w.-]{1,40}$/;
const textMap = (m, key) => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {})
  .filter(([k, v]) => key.test(k) && typeof v === 'string' && !/[\r\n]/.test(v)));

// What a server may look like when it comes from the page or a marketplace listing.
export function cleanConfig(conf) {
  if (typeof conf?.url === 'string' && conf.url.trim()) {
    let url;
    try { url = new URL(conf.url.trim()); } catch { throw fail(400, 'That is not a valid URL.'); }
    if (!/^https?:$/.test(url.protocol)) throw fail(400, 'MCP URLs start with https:// or http://.');
    const headers = textMap(conf.headers, /^[\w-]{1,64}$/);
    return { url: url.href, ...(Object.keys(headers).length ? { headers } : {}) };
  }
  if (typeof conf?.command === 'string' && conf.command.trim()) {
    const env = textMap(conf.env, /^[A-Za-z_]\w{0,63}$/);
    return { command: conf.command.trim(), args: Array.isArray(conf.args) ? conf.args.map(String) : [], ...(Object.keys(env).length ? { env } : {}) };
  }
  throw fail(400, 'An MCP server needs a command or an http(s) URL.');
}

// Edits only "mcpServers", and refuses a settings file it can't parse rather than overwrite it.
function editServers(change) {
  let settings = {};
  if (fs.existsSync(settingsPath())) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { throw fail(409, 'settings.json is not valid JSON. Fix it in Settings first.'); }
  }
  settings.mcpServers = change({ ...settings.mcpServers });
  writeAtomic(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
  reload();
}

export function addServer(name, conf) {
  if (!SERVER_NAME.test(String(name))) throw fail(400, 'Server names use letters, numbers, dot, dash or underscore (up to 40).');
  const clean = cleanConfig(conf);
  editServers(all => ({ ...all, [name]: clean }));
}

export function removeServer(name) {
  editServers(all => { delete all[name]; return all; });
}
