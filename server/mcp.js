import { spawn } from 'node:child_process';
import { childEnv, readSettings } from './util.js';

// Minimal MCP client for stdio servers (newline-delimited JSON-RPC), configured under
// "mcpServers" in ~/.nexus/settings.json.
// ponytail: stdio transport only; add streamable HTTP when a remote server is needed.
const servers = new Map();

class Server {
  constructor(name, conf) {
    this.name = name; this.tools = []; this.status = 'starting'; this.error = null;
    this.nextId = 1; this.waiting = new Map(); this.buf = '';
    this.proc = spawn(conf.command, conf.args || [], { env: { ...childEnv(), ...conf.env }, stdio: ['pipe', 'pipe', 'ignore'] });
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
    await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'nexus', version: '1.0.0' } }, 30000);
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    this.tools = (await this.request('tools/list', {}, 30000)).tools || [];
    this.status = 'connected';
  }
}

export function reload() {
  for (const s of servers.values()) s.proc.kill();
  servers.clear();
  for (const [name, conf] of Object.entries(readSettings().mcpServers || {})) {
    if (conf?.command) servers.set(name, new Server(name, conf));
  }
}

const toolName = (server, tool) => `mcp__${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

export async function toolDefs() {
  await Promise.all([...servers.values()].map(s => s.ready));
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

export const status = () => [...servers.values()].map(s => ({ name: s.name, status: s.status, error: s.error, tools: s.tools.map(t => t.name) }));
