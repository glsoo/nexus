import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { presentSocket } from '../server/util.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'present-'));
const env = { ...process.env, NEXUS_HOME: path.join(tmp, 'home') };
const script = fileURLToPath(new URL('../scripts/present.js', import.meta.url));
const site = path.join(tmp, 'site');
fs.mkdirSync(path.join(site, 'sub'), { recursive: true });
fs.writeFileSync(path.join(site, 'a.md'), '# Hi');
fs.writeFileSync(path.join(site, 'clip.mp4'), '0123456789');
fs.writeFileSync(path.join(site, '.env'), 'SECRET');
fs.writeFileSync(path.join(tmp, 'outside.txt'), 'SECRET');
if (process.platform === 'win32') {
  fs.mkdirSync(path.join(tmp, 'outside'));
  fs.symlinkSync(path.join(tmp, 'outside'), path.join(site, 'link.txt'), 'junction');
} else fs.symlinkSync(path.join(tmp, 'outside.txt'), path.join(site, 'link.txt'));

const run = (...args) => execFileSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
const get = (id, url, headers = {}) => new Promise((resolve, reject) => {
  http.get({ socketPath: presentSocket(id, env.NEXUS_HOME), path: url, headers }, res => {
    let body = '';
    res.on('data', d => { body += d; });
    res.on('end', () => resolve({ status: res.statusCode, body, type: res.headers['content-type'], disposition: res.headers['content-disposition'] }));
  }).on('error', reject);
});

test('a folder serves its files and nothing hidden or outside it', async () => {
  const id = /present\/([\w-]{16})\//.exec(run(site))[1];
  try {
    const md = await get(id, '/a.md');
    assert.match(md.body, /<h1>Hi<\/h1>/);
    assert.equal((await get(id, '/clip.mp4', { range: 'bytes=2-4' })).body, '234');
    const list = await get(id, '/');
    assert.match(list.body, /a\.md/);
    assert.doesNotMatch(list.body, /\.env/);
    for (const bad of ['/.env', '/%2eenv', '/link.txt', '/..%2foutside.txt', '/sub/..%2f..%2foutside.txt', '/%ff']) {
      const res = await get(id, bad);
      assert.equal(res.status, 404, bad);
      assert.doesNotMatch(res.body, /SECRET/, bad);
    }
  } finally {
    run('stop', id);
  }
  await new Promise(r => setTimeout(r, 200));
  assert.equal(fs.existsSync(path.join(env.NEXUS_HOME, 'present', `${id}.ready`)), false);
});

test('a single file serves only itself, and a bad ttl is refused', async () => {
  const id = /present\/([\w-]{16})\//.exec(run(path.join(site, 'a.md'), '--ttl', '5m'))[1];
  assert.equal((await get(id, '/')).status, 200);
  assert.equal((await get(id, '/.env')).status, 404);
  const saved = await get(id, '/?download');
  assert.equal(saved.body, '# Hi');
  assert.match(saved.disposition, /^attachment; filename\*=UTF-8''a\.md$/);
  assert.equal((await get(id, '/')).disposition, undefined);
  run('stop', id);
  assert.throws(() => run(site, '--ttl', '9d'));
});

test('directory finds and shows listings', async () => {
  const pages = {
    '/api/sitemap-mcp-servers.xml': '<loc>https://x/mcp-servers/postgres-mcp</loc><loc>https://x/mcp-servers/other</loc>',
    '/api/sitemap-agents.xml': '<loc>https://x/agents/tusk</loc>',
    '/mcp-servers/postgres-mcp': '<a>nav</a>Home / <b>postgres</b> &amp; more<a href="https://github.com/a/b">x</a><script>{"c":"npx -y pg-mcp --flag\\n"}</script>',
  };
  const srv = http.createServer((req, res) => {
    const page = req.url.startsWith('/agents?q=postgres') ? '<a href="/agents/pg-agent">' : pages[req.url];
    res.writeHead(page === undefined ? 404 : 200).end(page);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const run = args => new Promise(r => execFile(process.execPath, ['scripts/directory.js', ...args],
    { env: { ...process.env, DIRECTORY_URL: `http://127.0.0.1:${srv.address().port}` } }, (err, out) => r({ code: err?.code || 0, out })));
  try {
    assert.equal((await run(['search', 'postgres'])).out.trim(), 'mcp-servers/postgres-mcp\nagents/pg-agent');
    const { out } = await run(['show', 'mcp-servers/postgres-mcp']);
    assert.match(out, /^Home \/ postgres & more/);
    assert.match(out, /github\.com\/a\/b/);
    assert.match(out, /npx -y pg-mcp --flag/);
    assert.equal((await run(['show', '../secret'])).code, 1);
  } finally { srv.close(); }
});

test('the chat turns a download link into a file card with the real name and size', async () => {
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const code = app.slice(app.indexOf('const bytes ='), app.indexOf('// The clipboard API'));
  const h = (tag, props, ...kids) => ({ tag, ...props, kids, remove() { this.removed = true; } });
  const card = async (head, a = { pathname: '/present/abcdefghijklmnop/', search: '?download', textContent: 'Download guess.txt' }) => {
    const context = { h, icon: () => ({}), fetch: async () => head, Number, Math, decodeURIComponent };
    vm.runInNewContext(code, context);
    const el = context.fileCard(a);
    await new Promise(setImmediate);
    const [name, meta] = el.kids[1].kids;
    return { name, meta, save: el.kids[2] };
  };
  const headers = values => ({ get: key => values[key] ?? null });
  const live = await card({ ok: true, headers: headers({ 'content-disposition': "attachment; filename*=UTF-8''my%20report.pdf", 'content-length': '2048' }) });
  assert.equal(live.name.textContent, 'my report.pdf');
  assert.equal(live.meta.textContent, '2.0 KB · Temporary link');
  assert.equal(live.save.href, '/present/abcdefghijklmnop/?download');
  const ended = await card({ ok: false });
  assert.equal(ended.meta.textContent, 'This link has ended');
  assert.equal(ended.save.removed, true);
});
