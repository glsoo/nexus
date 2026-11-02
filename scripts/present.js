#!/usr/bin/env node
// Temporary host. `present.js <file|folder> [--ttl 1h]` prints a secret link, `present.js stop <id>` ends one early.
// Each presentation is its own small process on a unix socket; server/index.js proxies /present/<id>/ to it.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { marked } from 'marked';
import { isInside, NEXUS_HOME } from '../server/util.js';

const URL_BASE = `${process.env.NEXUS_URL || `http://127.0.0.1:${process.env.NEXUS_PORT || 7711}`}/present`;
const SOCKETS = path.join(NEXUS_HOME, 'present');
const MAX_RENDER = 5_000_000;
const UNIT = { m: 60_000, h: 3_600_000, d: 86_400_000 };
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};
const HTML = TYPES['.html'];

const sock = id => path.join(SOCKETS, `${id}.sock`);
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>${esc(title)}</title>
<style>:root{color-scheme:dark}body{box-sizing:border-box;max-width:860px;margin:0 auto;padding:max(20px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));background:#000;color:#eee;font:16px/1.6 system-ui,sans-serif;overflow-wrap:anywhere}a{color:#22c55e}img{max-width:100%}pre{overflow:auto;font:14px/1.5 ui-monospace,monospace}table{display:block;overflow:auto;border-collapse:collapse}td,th{border:1px solid #333;padding:6px 10px}li a{display:inline-block;padding:6px 0}</style>
${body}`;

function sendFile(req, res, file) {
  const ext = path.extname(file).toLowerCase();
  const { size } = fs.statSync(file);
  const type = TYPES[ext];
  if (!type && size <= MAX_RENDER) {
    const buf = fs.readFileSync(file);
    if (!buf.subarray(0, 8000).includes(0)) {
      const text = buf.toString('utf8');
      res.writeHead(200, { 'content-type': HTML }).end(page(path.basename(file), ext === '.md' ? marked.parse(text) : `<pre>${esc(text)}</pre>`));
      return;
    }
  }
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (range && start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }).end(); return; }
  res.writeHead(range ? 206 : 200, {
    'content-type': type || 'application/octet-stream', 'content-length': end - start + 1, 'accept-ranges': 'bytes',
    ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
    ...(type ? {} : { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}` }),
  });
  if (req.method === 'HEAD' || !size) res.end();
  else fs.createReadStream(file, { start, end }).pipe(res);
}

function sendFolder(req, res, root, rel) {
  const dir = path.join(root, rel);
  if (rel && !rel.endsWith('/')) { res.writeHead(308, { location: `${encodeURIComponent(path.basename(rel))}/` }).end(); return; }
  if (fs.existsSync(path.join(dir, 'index.html'))) { sendFile(req, res, path.join(dir, 'index.html')); return; }
  const items = fs.readdirSync(dir, { withFileTypes: true }).filter(d => !d.name.startsWith('.'))
    .map(d => `<li><a href="${encodeURIComponent(d.name)}${d.isDirectory() ? '/' : ''}">${esc(d.name)}${d.isDirectory() ? '/' : ''}</a></li>`);
  res.writeHead(200, { 'content-type': HTML }).end(page(path.basename(root), `<h1>${esc(path.basename(root))}</h1><ul>${items.join('')}</ul>`));
}

function serve(id, target, ms) {
  const isFolder = fs.statSync(target).isDirectory();
  const server = http.createServer((req, res) => {
    if (req.method === 'DELETE') { res.end(); process.exit(); }
    try {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice(1);
      if (!isFolder) {
        if (rel) throw new Error('A single file has no other paths.');
        sendFile(req, res, target);
        return;
      }
      if (rel.split('/').some(part => part.startsWith('.')) || !isInside(target, rel)) throw new Error('Hidden or outside the folder.');
      const file = path.join(target, rel);
      if (fs.statSync(file).isDirectory()) sendFolder(req, res, target, rel);
      else sendFile(req, res, file);
    } catch {
      if (!res.headersSent) res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
    }
  });
  process.on('exit', () => fs.rmSync(sock(id), { force: true }));
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => process.exit());
  setTimeout(() => process.exit(), ms);
  server.listen(sock(id));
}

function start(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { ttl: { type: 'string', default: '1h' } } });
  const ttl = /^(\d+)([mhd])$/.exec(values.ttl);
  const ms = ttl && Number(ttl[1]) * UNIT[ttl[2]];
  if (!ms || ms > 7 * UNIT.d) throw new Error('--ttl looks like 30m, 2h or 3d, up to 7d.');
  if (positionals.length !== 1) throw new Error('Usage: present.js <file|folder> [--ttl 1h]  |  present.js stop <id>');
  const target = fs.realpathSync(positionals[0]);
  fs.mkdirSync(SOCKETS, { recursive: true, mode: 0o700 });
  const id = randomBytes(12).toString('base64url');
  spawn(process.execPath, [process.argv[1], '--serve', id, target, String(ms)], { detached: true, stdio: 'ignore', cwd: SOCKETS }).unref();
  for (const until = Date.now() + 5000; !fs.existsSync(sock(id)); ) {
    if (Date.now() > until) throw new Error('The presentation server did not start.');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  console.log(`${URL_BASE}/${id}/`);
  console.log(`Serving ${target} until ${new Date(Date.now() + ms).toLocaleString()}. Anyone with the link can open it.`);
  console.log(`End it early: node ${process.argv[1]} stop ${id}`);
}

function stop(id) {
  http.request({ socketPath: sock(id), method: 'DELETE' }, () => console.log('Stopped.'))
    .on('error', () => { console.error('No such presentation.'); process.exitCode = 1; }).end();
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === '--serve') serve(rest[0], rest[1], Number(rest[2]));
  else if (cmd === 'stop') stop(rest[0]);
  else start(process.argv.slice(2));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
