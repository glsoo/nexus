import fs from 'node:fs';
import path from 'node:path';
import agentCatalog, { CATEGORIES } from '../catalog/agents.js';
import mcpCatalog from '../catalog/mcp.js';
import { parseFrontmatter } from './extensions.js';

// The marketplace: hand-picked agents and MCP servers that ship with Nexus, plus live listings from
// aiagentslist.com and Hugging Face. Listing text comes from the internet: the page shows it as plain text,
// and installing anything always goes through a confirmation that shows exactly what will run.
const AAL = 'https://aiagentslist.com';
const HF = 'https://huggingface.co';
const UA = { 'user-agent': 'Mozilla/5.0 (Nexus marketplace)' };
const TTL = 15 * 60_000;
const cache = new Map();
const fail = (status, message) => Object.assign(new Error(message), { status });

export const SOURCES = {
  agents: [['nexus', 'Nexus picks'], ['aiagentslist', 'aiagentslist.com'], ['huggingface', 'Hugging Face']],
  mcp: [['nexus', 'Nexus picks'], ['huggingface', 'Hugging Face'], ['aiagentslist', 'aiagentslist.com']],
  skills: [['anthropic', 'Anthropic'], ['skillssh', 'skills.sh']],
};
export const LINKS = {
  agents: [['aiagentslist.com/agents', `${AAL}/agents`], ['Hugging Face tiny-agents', `${HF}/datasets/tiny-agents/tiny-agents`]],
  mcp: [['aiagentslist.com/mcp-servers', `${AAL}/mcp-servers`], ['Hugging Face MCP Spaces', `${HF}/spaces?filter=mcp-server`], ['MCP servers on GitHub', 'https://github.com/modelcontextprotocol/servers']],
  skills: [['skills.sh', 'https://skills.sh'], ['Anthropic skills on GitHub', 'https://github.com/anthropics/skills'], ['agent-skills by Addy Osmani', 'https://github.com/addyosmani/agent-skills']],
};

async function get(url, json = false) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  let res;
  try { res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) }); } catch (err) { throw fail(502, `Couldn't reach ${new URL(url).host}: ${err.message}`); }
  if (!res.ok) throw fail(res.status === 404 ? 404 : 502, `${new URL(url).host} answered ${res.status}.`);
  const value = json ? await res.json() : await res.text();
  cache.set(url, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
}

const words = q => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
const matches = (terms, ...fields) => terms.every(t => fields.join(' ').toLowerCase().includes(t));
const serverName = s => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'server';
const compact = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

// ---- Nexus picks ----
const pickAgent = c => ({ source: 'nexus', kind: 'agents', id: c.name, name: c.name, description: c.description, category: c.category, featured: Boolean(c.featured), credit: c.credit, installable: true });
const pickServer = c => ({ source: 'nexus', kind: 'mcp', id: c.id, name: c.name, description: c.description, category: c.category, icon: c.icon, featured: Boolean(c.featured), url: c.url, installable: true });

function nexus(kind, terms) {
  if (kind === 'agents') {
    const order = c => (c.featured ? -1 : CATEGORIES.indexOf(c.category));
    return agentCatalog.filter(c => matches(terms, c.name, c.description, c.category)).sort((x, y) => order(x) - order(y)).map(pickAgent);
  }
  return mcpCatalog.filter(c => matches(terms, c.name, c.description, c.category)).sort((x, y) => y.featured - x.featured).map(pickServer);
}

function nexusItem(kind, id) {
  if (kind === 'agents') {
    const c = agentCatalog.find(x => x.name === id);
    if (!c) throw fail(404, 'No such agent in the catalog.');
    const prompt = c.credit ? `${c.prompt}\n\n<!-- ${c.credit} -->` : c.prompt;
    return { ...pickAgent(c), agent: { name: c.name, description: c.description, tools: c.tools, prompt } };
  }
  const c = mcpCatalog.find(x => x.id === id);
  if (!c) throw fail(404, 'No such server in the catalog.');
  return { ...pickServer(c), server: { name: c.id, config: c.config, inputs: c.inputs || [] } };
}

// ---- aiagentslist.com: no API, so cards from listing pages, names from the sitemap, details from each page ----
const decode = s => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const text = html => decode(String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const SECTION = { agents: 'agents', mcp: 'mcp-servers' };

export function parseCards(html, kind) {
  const section = SECTION[kind];
  const seen = new Set();
  const out = [];
  for (const [, slug, body] of html.matchAll(new RegExp(`<a href="/${section}/([\\w.-]+)"[^>]*>([\\s\\S]*?)</a>`, 'g'))) {
    if (seen.has(slug) || slug === 'categories') continue;
    const name = text(/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(body)?.[1]);
    if (!name) continue;
    seen.add(slug);
    const paras = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(m => text(m[1]));
    const by = paras.find(p => p.startsWith('by '));
    const [author, category] = by ? by.slice(3).split(/\s+·\s+/) : [];
    const stars = /<\/svg>\s*([\d,]+)/.exec(body)?.[1];
    out.push({
      source: 'aiagentslist', kind, id: slug, name, author, category,
      description: paras.filter(p => p !== by).at(-1) || '', stats: stars ? `★ ${stars}` : undefined,
      url: `${AAL}/${section}/${slug}`, installable: kind === 'mcp',
    });
  }
  return out;
}

async function aiagentslist(kind, terms) {
  if (kind === 'agents') return parseCards(await get(`${AAL}/agents${terms.length ? `?q=${encodeURIComponent(terms.join(' '))}` : ''}`), kind);
  const top = parseCards(await get(`${AAL}/mcp-servers`), kind);
  if (!terms.length) return top;
  // ponytail: the MCP listing ignores search, so matches come from slugs; the first few get descriptions fetched.
  const sitemap = await get(`${AAL}/api/sitemap-mcp-servers.xml`);
  const slugs = [...new Set([...sitemap.matchAll(/<loc>[^<]*\/mcp-servers\/([\w.-]+)<\/loc>/g)].map(m => m[1]))]
    .filter(slug => matches(terms, slug.replace(/-/g, ' ')));
  const known = new Map(top.map(c => [c.id, c]));
  const found = await Promise.all(slugs.slice(0, 30).map(async (slug, i) => {
    if (known.has(slug)) return known.get(slug);
    const item = { source: 'aiagentslist', kind, id: slug, name: slug, description: '', url: `${AAL}/mcp-servers/${slug}`, installable: true };
    if (i < 10) item.description = await get(item.url).then(pageDescription).catch(() => '');
    return item;
  }));
  return found;
}

const pageDescription = html => decode(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] || '');

// The JSON config snippet a listing shows, e.g. { "mcpServers": { "name": { "command": "npx", ... } } }.
export function configFrom(html) {
  for (const source of [decode(html), decode(html.replace(/\\n/g, '\n').replace(/\\"/g, '"'))]) {
    for (let at = source.indexOf('"mcpServers"'); at >= 0; at = source.indexOf('"mcpServers"', at + 1)) {
      const open = source.indexOf('{', at);
      const json = balanced(source, open);
      if (!json) continue;
      try {
        const first = Object.entries(JSON.parse(json))[0];
        if (first?.[1] && typeof first[1] === 'object') return { name: first[0], conf: first[1] };
      } catch { /* not plain JSON; try the next one */ }
    }
  }
  return null;
}

function balanced(s, open) {
  if (open < 0) return null;
  let depth = 0, inString = false;
  for (let i = open; i < s.length && i < open + 4000; i++) {
    const c = s[i];
    if (inString) { if (c === '\\') i++; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return s.slice(open, i + 1);
  }
  return null;
}

export function splitCommand(line) {
  const argv = [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3]);
  // npx asks before installing, which would hang a server that talks over stdin.
  if (argv[0] === 'npx' && !argv.includes('-y') && !argv.includes('--yes')) argv.splice(1, 0, '-y');
  return argv;
}

const SECRET = /key|token|secret|password|pat$/i;
// Placeholder values in a listing's env become questions in the install dialog.
function serverFrom(name, conf) {
  const url = conf.url || conf.serverUrl;
  if (typeof url === 'string') return { name: serverName(name), config: { url }, inputs: [] };
  if (typeof conf.command !== 'string') return null;
  const inputs = Object.entries(conf.env || {}).map(([env, hint]) => ({ env, label: env, hint: String(hint), secret: SECRET.test(env) }));
  return { name: serverName(name), config: { command: conf.command, args: (conf.args || []).map(String) }, inputs };
}

async function aiagentslistItem(kind, id) {
  if (!/^[\w.-]+$/.test(id)) throw fail(400, 'Bad listing id.');
  const url = `${AAL}/${SECTION[kind]}/${id}`;
  const html = await get(url);
  const github = [...new Set(html.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/g) || [])].filter(u => !/aiagentslist/i.test(u)).slice(0, 3);
  const item = {
    source: 'aiagentslist', kind, id, name: text(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]) || id, description: pageDescription(html),
    url, links: [['aiagentslist.com', url], ...github.map(g => ['GitHub', g])], installable: kind === 'mcp',
  };
  if (kind === 'agents') return { ...item, external: true };
  const found = configFrom(html);
  let server = found && serverFrom(found.name, found.conf);
  if (!server) {
    const line = decode(html).match(/\b(?:npx|uvx|docker run)\b[^\n"<\\]{3,160}/)?.[0]?.trim();
    if (line) { const [command, ...args] = splitCommand(line); server = { name: serverName(id), config: { command, args }, inputs: [] }; }
  }
  return { ...item, installable: Boolean(server), server, notes: 'Taken from the listing, which can be out of date: check the command against the GitHub README before installing.' };
}

// ---- Hugging Face: MCP Spaces (Gradio 6 speaks streamable HTTP, older ones go through mcp-remote) and tiny-agents ----
const SPACE_FIELDS = ['cardData', 'likes', 'subdomain', 'runtime', 'author'].map(f => `expand[]=${f}`).join('&');

function spaceItem(s) {
  const card = s.cardData || {};
  return {
    source: 'huggingface', kind: 'mcp', id: s.id, name: card.title || s.id.split('/')[1], author: s.author, icon: card.emoji,
    description: card.short_description || '', stats: `♥ ${compact(s.likes || 0)}`, url: `${HF}/spaces/${s.id}`,
    running: s.runtime?.stage === 'RUNNING', installable: Boolean(s.subdomain), subdomain: s.subdomain, sdk: card.sdk_version,
  };
}

async function huggingface(kind, terms) {
  if (kind === 'mcp') {
    const spaces = await get(`${HF}/api/spaces?filter=mcp-server&sort=likes&direction=-1&limit=40&${SPACE_FIELDS}${terms.length ? `&search=${encodeURIComponent(terms.join(' '))}` : ''}`, true);
    const official = mcpCatalog.filter(c => c.id === 'huggingface' && matches(terms, c.name, c.description)).map(c => ({ ...pickServer(c), source: 'huggingface', id: 'hf-mcp' }));
    return [...official, ...spaces.map(spaceItem)];
  }
  return (await tinyAgents()).filter(t => matches(terms, t.name, t.author, t.description)).map(({ spec, prompt, ...t }) => t);
}

async function tinyAgents() {
  const tree = await get(`${HF}/api/datasets/tiny-agents/tiny-agents/tree/main?recursive=true`, true);
  const files = new Set(tree.filter(f => f.type === 'file').map(f => f.path));
  const ids = [...files].filter(p => /^[\w.-]+\/[\w.-]+\/agent\.json$/.test(p)).map(p => p.slice(0, -'/agent.json'.length));
  return Promise.all(ids.map(async id => {
    const spec = await get(`${HF}/datasets/tiny-agents/tiny-agents/resolve/main/${id}/agent.json`, true).catch(() => ({}));
    const servers = (spec.servers || []).map(s => s.url || [s.command, ...(s.args || [])].join(' ')).filter(Boolean);
    const [author, name] = id.split('/');
    return {
      source: 'huggingface', kind: 'agents', id, name, author, url: `${HF}/datasets/tiny-agents/tiny-agents/tree/main/${id}`, installable: true,
      description: `Tiny agent${spec.model ? ` built for ${spec.model}` : ''}${servers.length ? `, with ${servers.length} MCP server${servers.length > 1 ? 's' : ''}: ${servers.join(', ').slice(0, 160)}` : ''}.`,
      prompt: ['PROMPT.md', 'AGENTS.md'].map(f => `${id}/${f}`).find(f => files.has(f)), spec,
    };
  }));
}

async function huggingfaceItem(kind, id) {
  if (kind === 'mcp') {
    if (id === 'hf-mcp') return { ...nexusItem('mcp', 'huggingface'), source: 'huggingface', id };
    if (!/^[\w.-]+\/[\w.-]+$/.test(id)) throw fail(400, 'Bad Space id.');
    const s = await get(`${HF}/api/spaces/${id}?${SPACE_FIELDS}`, true);
    const item = spaceItem(s);
    const modern = Number(String(item.sdk || '').split('.')[0]) >= 6;
    const base = `https://${item.subdomain}.hf.space/gradio_api/mcp/`;
    const config = modern ? { url: base } : { command: 'npx', args: ['-y', 'mcp-remote', `${base}sse`] };
    return {
      ...item, links: [['Hugging Face', item.url]], server: { name: serverName(item.name), config, inputs: [] },
      notes: `Runs on Hugging Face, so what the agent sends this Space's tools goes to it.${item.running ? '' : ' It is asleep now and takes a minute to wake.'}${modern ? '' : ' It uses the older SSE transport, so it connects through mcp-remote.'}`,
    };
  }
  const t = (await tinyAgents()).find(x => x.id === id);
  if (!t) throw fail(404, 'No such tiny agent.');
  const prompt = t.prompt ? await get(`${HF}/datasets/tiny-agents/tiny-agents/resolve/main/${t.prompt}`).catch(() => '') : '';
  const servers = (t.spec.servers || []).map((s, i) => {
    const name = `${t.name}${i ? `-${i + 1}` : ''}`;
    if (s.url) return { name: serverName(name), config: { url: s.url }, inputs: [] };
    return s.command ? serverFrom(name, s) : null;
  }).filter(Boolean);
  return {
    ...t, spec: undefined, prompt: undefined, links: [['Hugging Face', t.url]], servers,
    agent: { name: serverName(t.name), description: t.description, tools: null, prompt: prompt.trim() || `You are the ${t.name} agent from Hugging Face's tiny-agents. Use its MCP tools to do what the user asks, and say which tools you used.` },
    notes: 'Installs the agent type and its MCP servers. Values like ${input:...} are placeholders to fill in.',
  };
}

// ---- skills: a folder with a SKILL.md. Every list points at GitHub, so that is where they are read from ----
// ponytail: unauthenticated GitHub API (60 requests an hour); one tree request per repo, cached, and files come from raw.githubusercontent.com.
const GH = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const REPO = /^[\w.-]+\/[\w.-]+$/;
const MAX_FILES = 200, MAX_BYTES = 10 * 1024 * 1024;
const rawUrl = (repo, file) => `${RAW}/${repo}/HEAD/${file.split('/').map(encodeURIComponent).join('/')}`;
const repoFiles = async repo => {
  if (!REPO.test(repo)) throw fail(400, 'Bad GitHub repository.');
  return (await get(`${GH}/repos/${repo}/git/trees/HEAD?recursive=1`, true)).tree.filter(f => f.type === 'blob');
};
// '' for a repo whose root is the skill
const skillDirs = files => files.filter(f => f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md')).map(f => f.path.slice(0, -'SKILL.md'.length).replace(/\/$/, ''));

async function skillAt(repo, dir, source) {
  const { meta } = parseFrontmatter(await get(rawUrl(repo, dir ? `${dir}/SKILL.md` : 'SKILL.md')).catch(() => ''));
  return { source, kind: 'skills', id: `${repo}:${dir}`, name: meta.name || dir.split('/').pop() || repo.split('/')[1], author: repo.split('/')[0],
    description: meta.description || '', url: `https://github.com/${repo}/tree/HEAD/${dir}`, installable: true };
}

async function repoSkills(repo, under, terms, source) {
  const dirs = skillDirs(await repoFiles(repo)).filter(d => !under || d === under || d.startsWith(`${under}/`));
  const found = await Promise.all(dirs.slice(0, 60).map(d => skillAt(repo, d, source)));
  return found.filter(i => matches(terms, i.name, i.description));
}

// A GitHub link pasted into the search box, to a repo, a folder or a SKILL.md: what lists like awesome-skills point at.
const githubLink = q => /github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/[^/\s]+\/?([^\s?#]*))?\/?(?:[?#]\S*)?$/.exec(String(q || '').trim());

async function skillssh(terms) {
  const q = terms.join(' ');
  if (q.length < 2) throw fail(400, 'Type at least two letters to search skills.sh, or paste a GitHub link to a skill.');
  const { skills = [] } = await get(`https://skills.sh/api/search?q=${encodeURIComponent(q)}`, true);
  return skills.filter(s => REPO.test(s.source)).slice(0, 60).map(s => ({
    source: 'skillssh', kind: 'skills', id: `${s.source}/${s.skillId}`, name: s.name, author: s.source, stats: `↓ ${compact(s.installs || 0)}`,
    description: `From ${s.source} on GitHub.`, url: `https://skills.sh/${s.source}/${s.skillId}`, installable: true,
  }));
}

// "owner/repo:dir" from a GitHub listing, or "owner/repo/skill" from skills.sh, which names the skill but not its folder.
async function skillItem(source, id) {
  let repo, dir;
  if (id.includes(':')) [repo, dir] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  else {
    const [owner, name, ...rest] = id.split('/');
    repo = `${owner}/${name}`;
    const want = rest.join('/'), dirs = skillDirs(await repoFiles(repo));
    dir = dirs.find(d => d.split('/').pop() === want);
    if (dir === undefined) dir = (await Promise.all(dirs.slice(0, 80).map(async d => [d, (await skillAt(repo, d)).name]))).find(([, n]) => n === want)?.[0];
    if (dir === undefined) throw fail(404, `Couldn't find the skill ${want} in ${repo}.`);
  }
  if (!REPO.test(repo) || dir.split('/').includes('..')) throw fail(400, 'Bad skill location.');
  const files = (await repoFiles(repo)).filter(f => !dir || f.path.startsWith(`${dir}/`));
  if (!files.some(f => f.path === (dir ? `${dir}/SKILL.md` : 'SKILL.md'))) throw fail(404, 'No SKILL.md there.');
  const size = files.reduce((a, f) => a + (f.size || 0), 0);
  const info = await skillAt(repo, dir, source);
  return {
    ...info, files: files.map(f => (dir ? f.path.slice(dir.length + 1) : f.path)), size, skill: { repo, dir }, links: [['GitHub', info.url]],
    installable: files.length <= MAX_FILES && size <= MAX_BYTES,
    notes: 'A skill is instructions plus any scripts or files it brings. The agent reads it when a task fits, and runs its scripts only with your approval, unless autopilot or bypass is on. Check the source first.',
  };
}

// Downloads the folder into <root>/skills/<name>, replacing an older copy only once the new one is complete.
export async function installSkill(repo, dir, root) {
  const it = await skillItem('github', `${repo}:${dir}`);
  if (!it.installable) throw fail(400, `${it.name} is too big to install (${it.files.length} files, ${Math.round(it.size / 1024)} KB).`);
  const name = it.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+|-+$/g, '').slice(0, 64) || 'skill';
  const dest = path.join(root, 'skills', name), part = `${dest}.part-${Date.now()}`;
  try {
    for (const rel of it.files) {
      if (path.isAbsolute(rel) || rel.split('/').some(p => p === '..' || p === '')) throw fail(400, `Unsafe path in the skill: ${rel}`);
      let res;
      try { res = await fetch(rawUrl(repo, dir ? `${dir}/${rel}` : rel), { headers: UA, signal: AbortSignal.timeout(30000) }); } catch (err) { throw fail(502, `Couldn't download ${rel}: ${err.message}`); }
      if (!res.ok) throw fail(502, `GitHub answered ${res.status} for ${rel}.`);
      const file = path.join(part, ...rel.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(part, dest);
  } finally {
    fs.rmSync(part, { recursive: true, force: true });
  }
  return name;
}

// ---- entry points ----
export async function search(kind, source, q) {
  if (!SOURCES[kind]?.some(([id]) => id === source)) throw fail(400, 'Unknown marketplace source.');
  const terms = words(q);
  if (kind === 'skills') {
    const link = githubLink(q);
    if (link) return repoSkills(link[1], (link[2] || '').replace(/\/?SKILL\.md$/, '').replace(/\/$/, ''), [], source);
    return source === 'anthropic' ? repoSkills('anthropics/skills', 'skills', terms, source) : skillssh(terms);
  }
  if (source === 'nexus') return nexus(kind, terms);
  return (source === 'aiagentslist' ? aiagentslist : huggingface)(kind, terms);
}

export async function item(kind, source, id) {
  if (!SOURCES[kind]?.some(([s]) => s === source)) throw fail(400, 'Unknown marketplace source.');
  if (kind === 'skills') return skillItem(source, String(id));
  if (source === 'nexus') return nexusItem(kind, id);
  return (source === 'aiagentslist' ? aiagentslistItem : huggingfaceItem)(kind, String(id));
}
