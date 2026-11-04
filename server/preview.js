import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';

// Live preview of a dev server (npm run dev on port 5173, say) through Nexus, so a phone or another computer can see the app.
// It runs on its own port, which makes it its own origin: the app's scripts can't call Nexus's API (non-GET API calls must come
// from Nexus's own origin) or read its cookie, and Nexus's session cookie is never passed on to the app.
// A signed link from Nexus picks the dev server's port and sets this origin's cookie; nothing else gets through.
export const PREVIEW_PORT = Number(process.env.NEXUS_PREVIEW_PORT) || (Number(process.env.NEXUS_PORT) || 7711) + 1;
const SECRET = crypto.randomBytes(32); // links end when Nexus restarts
const HOURS = 12;
const sign = text => crypto.createHmac('sha256', SECRET).update(text).digest('base64url');

export function previewToken(port) {
  const value = `${port}.${Date.now() + HOURS * 3600_000}`;
  return `${value}.${sign(value)}`;
}
export function portOf(token) {
  const [port, expires, mac] = String(token || '').split('.');
  if (!mac || !(Number(expires) > Date.now())) return null;
  const want = Buffer.from(sign(`${port}.${expires}`)), got = Buffer.from(mac);
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? Number(port) : null;
}
export const validPort = (port, own) => Number.isInteger(port) && port > 0 && port < 65536 && !own.includes(port);

const tokenOf = req => /(?:^|;\s*)nexus_preview=([^;]+)/.exec(req.headers.cookie || '')?.[1];
// The app gets its own cookies, never Nexus's session or this preview's.
const cookies = header => (header || '').split(/;\s*/).filter(c => c && !/^nexus_(session|preview)=/.test(c)).join('; ');
const upstreamHeaders = (req, port) => {
  const headers = { ...req.headers, host: `localhost:${port}` };
  const kept = cookies(req.headers.cookie);
  if (kept) headers.cookie = kept; else delete headers.cookie;
  return headers;
};
const text = (res, status, message) => res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(message);

export function startPreview(ownPorts) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__nexus_preview') {
      const token = url.searchParams.get('t');
      if (!portOf(token)) return text(res, 403, 'This preview link has expired. Open the preview from Nexus again.');
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      res.writeHead(302, { 'set-cookie': `nexus_preview=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${HOURS * 3600}${secure}`, location: '/', 'cache-control': 'no-store' }).end();
      return;
    }
    const port = portOf(tokenOf(req));
    if (!port || !validPort(port, ownPorts)) return text(res, 403, 'Open the preview from Nexus.');
    const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers: upstreamHeaders(req, port) }, r => {
      const headers = { ...r.headers };
      // A redirect to the dev server's own address stays inside the preview.
      if (headers.location) headers.location = headers.location.replace(new RegExp(`^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\]):${port}`), '');
      res.writeHead(r.statusCode, headers);
      r.pipe(res);
    });
    up.on('error', () => (res.headersSent ? res.destroy() : text(res, 502, `Nothing is answering on port ${port}. Start the dev server, then reload.`)));
    res.on('close', () => up.destroy());
    req.pipe(up);
  });
  // WebSockets, for the hot reload most dev servers use.
  server.on('upgrade', (req, socket, head) => {
    const port = portOf(tokenOf(req));
    if (!port || !validPort(port, ownPorts)) return socket.destroy();
    const up = net.connect(port, '127.0.0.1', () => {
      const headers = Object.entries(upstreamHeaders(req, port)).map(([k, v]) => `${k}: ${v}`).join('\r\n');
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
      if (head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    // Either side going away closes the other, so a closed tab doesn't leave the dev server's socket open.
    up.on('error', () => socket.destroy());
    up.on('close', () => socket.destroy());
    socket.on('error', () => up.destroy());
    socket.on('close', () => up.destroy());
    socket.on('end', () => up.destroy()); // the server's sockets allow half-open ones, which a WebSocket never needs
  });
  server.on('error', err => console.error(`Live preview is off: port ${PREVIEW_PORT} ${err.code === 'EADDRINUSE' ? 'is in use. Set NEXUS_PREVIEW_PORT to another port' : `failed (${err.message})`}.`));
  server.listen(PREVIEW_PORT, '127.0.0.1');
  return server;
}

// Ports a project's dev server may be on: those its running shells printed (localhost:5173 and the like), plus the usual
// dev server ports, kept when something is listening there.
const COMMON = [3000, 3001, 4200, 4321, 5000, 5173, 5174, 8000, 8080, 8081, 8888];
const listening = port => new Promise(resolve => {
  const s = net.connect({ port, host: '127.0.0.1', timeout: 300 }, () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
  s.on('timeout', () => { s.destroy(); resolve(false); });
});
export async function devPorts(outputs, ownPorts) {
  const seen = new Set(COMMON);
  for (const out of outputs) for (const m of out.matchAll(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})\b/g)) seen.add(Number(m[1]));
  const ports = [...seen].filter(p => validPort(p, ownPorts));
  const open = await Promise.all(ports.map(listening));
  return ports.filter((_, i) => open[i]).sort((a, b) => a - b);
}
