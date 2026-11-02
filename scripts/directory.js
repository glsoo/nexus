#!/usr/bin/env node
// Looks things up on aiagentslist.com, which has no API: sitemaps for names, listing pages for details.
const BASE = process.env.DIRECTORY_URL || 'https://aiagentslist.com';
const UA = { 'user-agent': 'Mozilla/5.0 (Nexus directory skill)' };
const MAX_TEXT = 6000;

async function get(path) {
  const res = await fetch(BASE + path, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

const decode = s => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const toText = html => decode(html.replace(/<(script|style)\b.*?<\/\1>/gs, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

async function search(words) {
  const paths = await Promise.all(['mcp-servers', 'agents'].map(async kind =>
    [...(await get(`/api/sitemap-${kind}.xml`)).matchAll(/<loc>[^<]*?\/((?:agents|mcp-servers)\/[^<\/]+)<\/loc>/g)].map(m => m[1])));
  const named = paths.flat().filter(p => words.every(w => p.toLowerCase().includes(w.toLowerCase())));
  // ponytail: names only for MCP servers, the site's own search covers agents; its MCP page ignores queries.
  const page = await get(`/agents?q=${encodeURIComponent(words.join(' '))}`);
  const found = [...page.matchAll(/href="\/(agents\/[^"\/?#]+)"/g)].map(m => m[1]);
  return [...new Set([...named, ...found])].slice(0, 40);
}

async function show(path) {
  if (!/^(agents|mcp-servers)\/[\w.-]+$/.test(path)) throw new Error('Expected agents/<slug> or mcp-servers/<slug>');
  const html = await get(`/${path}`);
  const raw = decode(html.replace(/\\n/g, '\n').replace(/\\"/g, '"'));
  const uniq = re => [...new Set([...raw.matchAll(re)].map(m => m[0].trim()))].slice(0, 12);
  const text = toText(html);
  const start = text.indexOf('Home /');
  return [
    text.slice(start < 0 ? 0 : start, (start < 0 ? 0 : start) + MAX_TEXT),
    '', 'GitHub:', ...uniq(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/g),
    '', 'Commands on the page:', ...uniq(/\b(?:npx|uvx|docker run|pip install)\b[^\n"<\\]{3,120}/g),
  ].join('\n');
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'search' && args.length) console.log((await search(args)).join('\n') || 'Nothing found.');
  else if (cmd === 'show' && args.length === 1) console.log(await show(args[0]));
  else { console.error('Usage: directory.js search <words...> | show <agents|mcp-servers>/<slug>'); process.exit(2); }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
