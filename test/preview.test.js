import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';

const free = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
process.env.NEXUS_PREVIEW_PORT = String(await free());
const preview = await import('../server/preview.js');
const get = (port, path, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers, agent: false }, res => { let body = ''; res.on('data', d => (body += d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body })); }).on('error', reject);
});

test('a preview link only works signed and unexpired, and never for Nexus itself', () => {
  const t = preview.previewToken(5173);
  assert.equal(preview.portOf(t), 5173);
  assert.equal(preview.portOf(t.replace('5173.', '5174.')), null, 'the port is part of the signature');
  assert.equal(preview.portOf('5173.99999999999999.forged'), null);
  assert.equal(preview.portOf(''), null);
  assert.equal(preview.validPort(7711, [7711, 7712]), false);
  assert.equal(preview.validPort(70000, []), false);
  assert.equal(preview.validPort(5173, [7711]), true);
});

test("the preview proxies the dev server on its own origin, without Nexus's cookies, and finds the port", { timeout: 20000 }, async () => {
  const seen = [];
  const app = http.createServer((req, res) => {
    seen.push({ host: req.headers.host, cookie: req.headers.cookie || '' });
    if (req.url === '/go') return res.writeHead(302, { location: `http://localhost:${app.address().port}/here` }).end();
    res.end(`app at ${req.url}`);
  });
  app.on('upgrade', (req, socket, head) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: upgrade\r\n\r\n');
    if (head.length) socket.write(head);
    socket.on('data', d => socket.write(d));
    socket.on('end', () => socket.destroy());
  });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  const port = app.address().port;
  const server = preview.startPreview([7711]);
  await new Promise(r => (server.listening ? r() : server.once('listening', r)));
  try {
    assert.equal((await get(preview.PREVIEW_PORT, '/')).status, 403, 'nothing without the link');
    const enter = await get(preview.PREVIEW_PORT, `/__nexus_preview?t=${encodeURIComponent(preview.previewToken(port))}`);
    assert.equal(enter.status, 302);
    const cookie = enter.headers['set-cookie'][0].split(';')[0];
    assert.match(cookie, /^nexus_preview=/);
    const page = await get(preview.PREVIEW_PORT, '/hello?x=1', { cookie: `nexus_session=SECRET; ${cookie}; theme=dark` });
    assert.equal(page.body, 'app at /hello?x=1');
    assert.deepEqual(seen.at(-1), { host: `localhost:${port}`, cookie: 'theme=dark' }, "Nexus's session never reaches the app");
    assert.equal((await get(preview.PREVIEW_PORT, '/go', { cookie })).headers.location, '/here', 'redirects stay in the preview');

    // Hot reload's WebSocket goes through too.
    const echoed = await new Promise((resolve, reject) => {
      const s = net.connect(preview.PREVIEW_PORT, '127.0.0.1', () => s.write(`GET /hmr HTTP/1.1\r\nhost: x\r\nupgrade: websocket\r\nconnection: upgrade\r\ncookie: ${cookie}\r\n\r\nping`));
      let buf = '';
      s.on('data', d => { buf += d; if (buf.includes('ping')) { s.destroy(); resolve(buf); } });
      s.on('error', reject);
    });
    assert.match(echoed, /101 Switching Protocols[\s\S]*ping/);

    assert.ok((await preview.devPorts([`  ➜  Local:   http://localhost:${port}/`], [7711])).includes(port), 'a port a shell printed, if listening');
  } finally {
    server.closeAllConnections(); server.close();
    app.closeAllConnections(); app.close();
  }
});
