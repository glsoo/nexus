const { marked, DOMPurify, hljs, Terminal, FitAddon } = window;
const $app = document.getElementById('app');

// ---- helpers ----
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || (v === false && !(k in el))) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false));
  return el;
}
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>', dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>', bot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M9 14h.01M15 14h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', pen: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', clip: '<path d="M21 11l-9 9a5.5 5.5 0 0 1-8-8l9-9a3.7 3.7 0 0 1 5 5l-9 9a1.8 1.8 0 0 1-3-3l8-8"/>',
  undo: '<path d="M3 7v6h6M3 13a9 9 0 1 0 3-7L3 9"/>', down: '<path d="M6 9l6 6 6-6"/>', check: '<path d="M5 13l4 4L19 7"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>', spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>', mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', back: '<path d="M15 18l-6-6 6-6"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.3c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
};
const icon = name => { const t = document.createElement('template'); t.innerHTML = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`; return t.content.firstChild; };

async function api(method, url, data) {
  const res = await fetch(url, { method, headers: data ? { 'content-type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Signed out.'); }
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
const P = name => `/api/projects/${encodeURIComponent(name)}`;

// Motion is transform and opacity only, so it stays on the compositor.
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const touch = matchMedia('(pointer: coarse)');
const phone = matchMedia('(max-width: 760px)');
const RISE = [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }];
const FADE = [{ opacity: 0 }, { opacity: 1 }];
const motion = (el, frames, ms = 260, fill = 'none') => (calm.matches || !el?.animate ? { finished: Promise.resolve() } : el.animate(frames, { duration: ms, easing: 'cubic-bezier(.22,1,.36,1)', fill }));
const exit = (el, to, ms = 160) => motion(el, [{}, to], ms, 'forwards').finished.catch(() => {});

function toast(text) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(el);
  setTimeout(() => exit(el, { opacity: 0, transform: 'translate(-50%, 12px)' }, 220).then(() => el.remove()), 5000);
}
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message); } };

function markdown(el, text, final = true) {
  el.innerHTML = DOMPurify.sanitize(marked.parse(text || ''));
  if (final) el.querySelectorAll('pre code').forEach(c => { hljs.highlightElement(c); c.parentElement.append(copyButton(() => c.textContent)); });
  el.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
}

// The clipboard API needs a secure context; plain http on a LAN address falls back to a selection copy.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    const t = h('textarea', { value: text, style: 'position:fixed;opacity:0' });
    document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
  }
}
const copyButton = get => h('button', { class: 'icon-btn copy', type: 'button', 'aria-label': 'Copy code', title: 'Copy', onclick: async e => {
  const b = e.currentTarget;
  await copyText(get());
  b.replaceChildren(icon('check')); b.classList.add('done');
  setTimeout(() => { b.replaceChildren(icon('copy')); b.classList.remove('done'); }, 1400);
} }, icon('copy'));
const usd = n => `$${(n || 0).toFixed(2)}`;
const fmt = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${s / 60 | 0}m ago` : s < 86400 ? `${s / 3600 | 0}h ago` : `${s / 86400 | 0}d ago`; };

function dialog({ title, body, wide, actions }) {
  return new Promise(resolve => {
    const shut = value => {
      resolve(value);
      d.classList.add('closing');
      exit(d, { opacity: 0, transform: 'scale(.97)' }).then(() => d.close());
    };
    const d = h('dialog', { class: wide ? 'wide' : '' }, h('h2', {}, title), body,
      h('div', { class: 'acts' }, actions.map(a => h('button', { class: `btn ${a.class || ''}`, type: 'button', onclick: async () => {
        if (a.run && (await a.run()) === false) return;
        shut(a.value);
      } }, a.label))));
    d.addEventListener('cancel', e => { e.preventDefault(); shut(); });
    d.addEventListener('close', () => { d.remove(); resolve(undefined); });
    document.body.append(d);
    d.showModal();
  });
}
const confirmBox = (title, text, label = 'Confirm', cls = 'primary') => dialog({ title, body: h('p', { class: 'muted' }, text), actions: [{ label: 'Cancel' }, { label, class: cls, value: true }] });

// ---- app state ----
const S = { project: null, tab: 'chat', page: null, state: null, ws: null, projects: [], models: [], meta: { commands: [], skills: [], agents: [] }, prompts: null, me: null, images: [] };
const entries = new Map();

// ---- login ----
function showLogin() {
  S.ws?.close(); S.ws = null; S.me = null;
  clearTimeout(wsTimer); $conn?.remove(); $conn = null;
  const err = h('div', { class: 'err', role: 'alert' });
  const user = h('input', { class: 'field', id: 'u', autocomplete: 'username', required: true, autocapitalize: 'off', spellcheck: false });
  const pass = h('input', { class: 'field', id: 'p', type: 'password', autocomplete: 'current-password', required: true });
  const go = h('button', { class: 'btn primary' }, 'Sign in');
  $app.replaceChildren(h('main', { class: 'login' }, h('form', { onsubmit: async e => {
    e.preventDefault();
    go.disabled = true; err.textContent = '';
    try { await api('POST', '/api/login', { user: user.value, pass: pass.value }); await boot(); } catch (x) { err.textContent = x.message; pass.select(); } finally { go.disabled = false; }
  } },
  h('div', { class: 'brand' }, h('img', { src: '/icon.svg?v=purple', alt: '' }), h('h1', { style: 'font:inherit' }, 'Nexus')),
  h('div', {}, h('label', { class: 'lbl', htmlFor: 'u' }, 'Username'), user),
  h('div', {}, h('label', { class: 'lbl', htmlFor: 'p' }, 'Password'), pass),
  err, go)));
  user.focus();
}

// ---- layout ----
let $list, $main, $side, $scrim, $find;
function shell() {
  $list = h('nav', { class: 'plist', 'aria-label': 'Projects' });
  let findTimer;
  $find = h('input', { class: 'field find', type: 'search', placeholder: 'Search chats', 'aria-label': 'Search chats', autocomplete: 'off',
    oninput: () => { clearTimeout(findTimer); findTimer = setTimeout(guard(findChats), 200); },
    onkeydown: e => { if (e.key === 'Escape' && $find.value) { e.stopPropagation(); $find.value = ''; guard(findChats)(); } } });
  $main = h('main', { class: 'main' });
  $scrim = h('div', { class: 'scrim', onclick: () => drawer(false) });
  $side = h('aside', { class: 'side' },
    h('div', { class: 'side-head' }, h('img', { src: '/icon.svg?v=purple', alt: '' }), 'Nexus'),
    h('div', { class: 'newrow' }, h('button', { class: 'btn new', onclick: guard(newProject) }, icon('plus'), 'New project'),
      h('button', { class: 'btn', 'aria-label': 'Clone a git repository', title: 'Clone a git repository', onclick: cloneDialog }, icon('download'))),
    $find, $list,
    h('div', { class: 'side-foot' },
      // Keeps the open project, which is where agents get installed.
      h('button', { class: 'navbtn', id: 'nav-market', onclick: () => go(S.project, 'marketplace') }, icon('grid'), 'Marketplace'),
      h('button', { class: 'navbtn', id: 'nav-agents', onclick: () => go(null, 'agents') }, icon('bot'), 'Agents'),
      h('button', { class: 'navbtn', id: 'nav-settings', onclick: () => go(null, 'settings') }, icon('gear'), 'Settings'),
      h('button', { class: 'navbtn', onclick: guard(async () => { await api('POST', '/api/logout'); showLogin(); }) }, icon('out'), 'Sign out')));
  $app.replaceChildren(h('div', { class: 'shell' }, $scrim, $side, $main));
}
const drawer = open => { $side.classList.toggle('open', open); $scrim.classList.toggle('open', open); };

// The folder keeps its dashes; only what people read changes. "say-hello" shows as "Say Hello".
const pretty = name => name.replace(/[-_]+/g, ' ').replace(/\.+$/, '').replace(/\b[a-z]/g, c => c.toUpperCase());

async function newProject() {
  const { name } = await api('POST', '/api/projects', {});
  await refreshProjects();
  go(name, null, 'chat');
}

function cloneDialog() {
  const err = h('div', { class: 'err', role: 'alert' });
  const input = h('input', { class: 'field mono', id: 'cu', type: 'url', placeholder: 'https://github.com/owner/repo', 'aria-describedby': 'cu-hint', spellcheck: false, autocapitalize: 'off' });
  let busy = false;
  const run = async () => {
    if (busy) return false;
    busy = true; err.textContent = 'Cloning…';
    try {
      const { name } = await api('POST', '/api/projects/clone', { url: input.value });
      await refreshProjects();
      go(name, null, 'chat');
      return true;
    } catch (e) { err.textContent = e.message; return false; } finally { busy = false; }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.closest('dialog').querySelector('.primary').click(); } });
  dialog({ title: 'Clone a repository', body: h('div', {}, h('label', { class: 'lbl', htmlFor: 'cu' }, 'Git URL'), input,
    h('p', { class: 'small muted', id: 'cu-hint' }, "It becomes a new project named after the repo. Private repos use this computer's git credentials."), err),
  actions: [{ label: 'Cancel' }, { label: 'Clone', class: 'primary', run }] });
  input.focus();
}

async function refreshProjects() {
  S.projects = await api('GET', '/api/projects');
  if ($find.value.trim()) return; // search results stay until the box is cleared
  $list.replaceChildren(...S.projects.map(p => h('div', { class: `pitem ${p.name === S.project && !S.page ? 'on' : ''}` },
    h('button', { class: 'open', title: pretty(p.name), 'aria-current': p.name === S.project ? 'true' : undefined, onclick: () => go(p.name, null, 'chat') },
      h('span', { class: `dot ${p.busy ? 'busy' : ''}` }), h('span', { class: 'nm' }, pretty(p.name))),
    h('button', { class: 'icon-btn', 'aria-label': `Options for ${pretty(p.name)}`, 'aria-haspopup': 'menu', onclick: e => projectMenu(e.currentTarget, p.name) }, icon('dots')))));
}
// Each hit opens its chat scrolled to the message.
let findSeq = 0;
async function findChats() {
  const q = $find.value.trim(), seq = ++findSeq;
  if (!q) return refreshProjects();
  const found = await api('GET', `/api/search?q=${encodeURIComponent(q)}`);
  if (seq !== findSeq) return;
  const open = (name, id) => { go(name, null, 'chat'); if (S.state?.name === name) jumpTo(id); else S.jump = id; };
  $list.replaceChildren(...(found.length ? found.map(r => h('div', { class: 'found' },
    h('div', { class: 'pitem' }, h('button', { class: 'open', onclick: () => open(r.name) }, h('span', { class: 'nm' }, pretty(r.name)))),
    ...r.hits.map(x => h('button', { class: 'snip', onclick: () => open(r.name, x.id) }, x.text)))) : [h('p', { class: 'small muted nohit' }, `No chats mention "${q}".`)]));
}
function jumpTo(id) {
  const el = id && entries.get(id)?.el;
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  el.classList.add('jumped');
  setTimeout(() => el.classList.remove('jumped'), 2000);
}

let refreshTimer;
const refreshSoon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(guard(refreshProjects), 200); };

function projectMenu(anchor, name) {
  document.querySelector('.menu')?.remove();
  const close = () => { exit(menu, { opacity: 0, transform: 'scale(.96)' }, 120).then(() => menu.remove()); document.removeEventListener('pointerdown', outside); anchor.focus(); };
  const outside = e => { if (!menu.contains(e.target)) close(); };
  const menu = h('div', { class: 'menu', role: 'menu', onkeydown: e => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...menu.querySelectorAll('button')];
      items[(items.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    }
  } },
  h('button', { role: 'menuitem', onclick: () => { close(); renameDialog(name); } }, icon('pen'), 'Rename'),
  h('button', { role: 'menuitem', onclick: () => { close(); exportChat(name); } }, icon('download'), 'Export chat'),
  h('button', { role: 'menuitem', class: 'danger', onclick: () => { close(); deleteDialog(name); } }, icon('trash'), 'Delete'));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
  menu.querySelector('button').focus();
  setTimeout(() => document.addEventListener('pointerdown', outside));
}

function renameDialog(name) {
  const err = h('div', { class: 'err', role: 'alert' });
  const input = h('input', { class: 'field mono', value: pretty(name), id: 'rn', 'aria-describedby': 'rn-hint', spellcheck: false, autocapitalize: 'off' });
  const save = async () => {
    if (input.value.trim() === pretty(name)) return true;
    const to = input.value.trim().replace(/\s+/g, '-');
    try { await api('POST', `${P(name)}/rename`, { to }); return true; } catch (e) { err.textContent = e.message; return false; }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.closest('dialog').querySelector('.primary').click(); } });
  dialog({ title: 'Rename project', body: h('div', {}, h('label', { class: 'lbl', htmlFor: 'rn' }, 'Name'), input,
    h('p', { class: 'small muted', id: 'rn-hint' }, `Moves the folder to ~/projects/<name>. Spaces become dashes.`), err),
  actions: [{ label: 'Cancel' }, { label: 'Rename', class: 'primary', run: save }] });
  input.select();
}

async function deleteDialog(name) {
  if (!await confirmBox(`Delete ${pretty(name)}?`, `The folder moves to ~/projects/.trash, where you can still recover it by hand.`, 'Delete', 'danger')) return;
  await guard(async () => {
    await api('DELETE', P(name));
    if (S.project === name) go(null);
    await refreshProjects();
  })();
}

// ---- navigation ----
function go(project, page = null, tab = 'chat') {
  drawer(false);
  if (project !== S.project) teardownTerm();
  const changed = project !== S.project;
  const moved = changed || page !== S.page;
  S.project = project; S.page = page; S.tab = tab;
  history.replaceState(null, '', page ? `#/${page}` : project ? `#/p/${encodeURIComponent(project)}/${tab}` : '#/');
  if (changed && project) { S.state = null; sendWs({ t: 'open', name: project }); guard(loadMeta)(); }
  render();
  if (moved) motion($main.lastElementChild, RISE);
  refreshSoon();
}
async function loadMeta() {
  const project = S.project;
  const [meta, prompts] = await Promise.all([api('GET', `${P(project)}/meta`), api('GET', `${P(project)}/prompts`).catch(() => null)]);
  if (project !== S.project) return;
  S.meta = meta; S.prompts = prompts;
  syncComposer();
}

let prevTab = 0;
function render() {
  document.getElementById('nav-agents').classList.toggle('on', S.page === 'agents');
  document.getElementById('nav-settings').classList.toggle('on', S.page === 'settings');
  document.getElementById('nav-market').classList.toggle('on', S.page === 'marketplace');
  syncTitle();
  const hamb = h('button', { class: 'icon-btn hamb', 'aria-label': 'Open menu', onclick: () => drawer(true) }, icon('menu'));
  if (S.page === 'agents') return agentsPage(hamb);
  if (S.page === 'marketplace') return marketPage(hamb);
  if (S.page === 'settings') return settingsPage(hamb);
  if (!S.project) {
    return $main.replaceChildren(h('header', { class: 'top' }, hamb, h('h1', {}, 'Nexus')),
      h('div', { class: 'empty' }, h('h2', {}, 'Start a project'), h('p', {}, 'Each conversation gets its own folder in ~/projects.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: guard(newProject) }, icon('plus'), 'New project'),
          h('button', { class: 'btn', onclick: cloneDialog }, icon('download'), 'Clone a repo'))));
  }
  const view = h('div', { class: 'view' });
  const tabs = [['chat', 'Chat'], ['files', 'Files'], ['changes', 'Changes'], ['terminal', 'Terminal']];
  const at = tabs.findIndex(([id]) => id === S.tab);
  const pill = h('span', { class: 'pill', style: `--i:${at}` });
  $main.replaceChildren(h('header', { class: 'top' }, hamb, h('h1', { title: pretty(S.project) }, pretty(S.project)),
    h('button', { class: 'icon-btn', 'aria-label': `Options for ${pretty(S.project)}`, onclick: e => projectMenu(e.currentTarget, S.project) }, icon('dots')),
    h('div', { class: 'tabs', role: 'tablist' }, pill, tabs.map(([id, label]) => h('button', { class: `tab ${S.tab === id ? 'on' : ''}`, role: 'tab', 'aria-selected': String(S.tab === id), onclick: () => go(S.project, null, id) }, label)))),
  view);
  ({ chat: chatView, files: filesView, changes: changesView, terminal: termView })[S.tab](view);
  // The header is rebuilt on each render, so the pill slides from the last index.
  if (prevTab !== at) {
    motion(pill, [{ transform: `translateX(${prevTab * 100}%)` }, { transform: `translateX(${at * 100}%)` }], 340);
    motion(view, [{ opacity: 0, transform: `translateX(${at > prevTab ? 24 : -24}px)` }, { opacity: 1, transform: 'none' }], 300);
    prevTab = at;
  }
}

// ---- title and notifications ----
// The tab shows ● while the agent works and ✓ when it finished out of sight; a notification is opt-in from Settings.
const pref = (key, value) => { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { /* private window */ } return null; };
let doneUnseen = false;
function syncTitle() {
  const base = S.project && !S.page ? `${pretty(S.project)} · Nexus` : 'Nexus';
  document.title = `${S.state?.running ? '● ' : doneUnseen ? '✓ ' : ''}${base}`;
}
function finished() {
  if (!document.hidden) return;
  doneUnseen = true;
  if (pref('nexus.notify') === '1' && window.Notification?.permission === 'granted') {
    new Notification('Nexus finished', { body: pretty(S.project), icon: '/icon-180.png', tag: `nexus-${S.project}` });
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && doneUnseen) { doneUnseen = false; syncTitle(); } });

// Web Push reaches the phone with Nexus closed: the server pings when a chat finishes or needs an answer.
// Its notifications share finished()'s tag, so a browser that gets both shows one.
const canPush = 'serviceWorker' in navigator && 'PushManager' in window;
async function setPush(on) {
  const reg = await navigator.serviceWorker.register('/sw.js');
  const old = await reg.pushManager.getSubscription();
  if (!on) {
    if (old) { await api('POST', '/api/push/unsubscribe', { endpoint: old.endpoint }).catch(() => {}); await old.unsubscribe(); }
    return;
  }
  const { key } = await api('GET', '/api/push/key');
  const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const sub = old || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
  await api('POST', '/api/push/subscribe', sub.toJSON());
}
if (canPush) navigator.serviceWorker.addEventListener('message', e => { if (S.projects.some(p => p.name === e.data?.open)) go(e.data.open); });

// ---- websocket ----
let wsRetry = 0, wsTimer, $conn, lastHeard = 0;
const connLost = (text = 'Connection lost. Reconnecting…') => {
  if (!$conn) { $conn = h('div', { class: 'conn', role: 'status' }); document.body.append($conn); }
  $conn.textContent = text;
};
function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  const old = S.ws;
  S.ws = ws;
  old?.close();
  clearTimeout(wsTimer);
  ws.onopen = () => {
    wsRetry = 0;
    lastHeard = Date.now();
    $conn?.remove(); $conn = null;
    if (S.project) ws.send(JSON.stringify({ t: 'open', name: S.project }));
    refreshSoon();
  };
  ws.onmessage = e => { lastHeard = Date.now(); onEvent(JSON.parse(e.data)); };
  ws.onclose = e => {
    if (S.ws !== ws) return;
    connLost(e.code === 1012 ? 'Server restarting…' : undefined);
    wsTimer = setTimeout(reconnect, Math.min(1000 * 2 ** wsRetry++, 15000));
  };
}
async function reconnect() {
  clearTimeout(wsTimer);
  try {
    const { build } = await api('GET', '/api/me');
    if (build !== S.me?.build) { location.reload(); return; }
    connect();
  } catch { if (S.me) wsTimer = setTimeout(reconnect, Math.min(1000 * 2 ** wsRetry++, 15000)); }
}
// A dropped network can leave a socket that still reads as open, so silence counts as lost. The server sends a heartbeat every 15s.
setInterval(() => {
  if (!S.me || document.hidden || S.ws?.readyState !== 1 || Date.now() - lastHeard < 35000) return;
  lastHeard = Date.now();
  connLost();
  reconnect();
}, 5000);
addEventListener('offline', () => { if (S.me) connLost(); });
addEventListener('online', () => { if (S.me) reconnect(); });
// iOS suspends backgrounded pages and can leave a dead socket that still reads as open.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); saveDrafts(); return; }
  if (S.me && (S.ws?.readyState !== 1 || Date.now() - hiddenAt > 20000)) reconnect();
});
const sendWs = m => { if (S.ws?.readyState === 1) S.ws.send(JSON.stringify(m)); };

function onEvent(m) {
  switch (m.t) {
    case 'state':
      { const first = !S.state;
        S.state = m.state;
        if (m.state.name !== S.project) return;
        if (S.tab === 'chat' && !S.page) { render(); if (first) motion($log, FADE); if (S.jump) { jumpTo(S.jump); S.jump = null; } } }
      break;
    case 'entry': {
      if (!S.state) return;
      const i = S.state.log.findIndex(x => x.id === m.entry.id);
      if (i >= 0) S.state.log[i] = m.entry; else S.state.log.push(m.entry);
      upsertEntry(m.entry);
      break;
    }
    case 'delta': delta(m); break;
    case 'status': {
      const was = S.state?.running;
      if (S.state) Object.assign(S.state, { running: m.running, usage: m.usage, todos: m.todos, mode: m.mode, model: m.model, effort: m.effort, agent: m.agent, autopilot: m.autopilot, budget: m.budget, compactAt: m.compactAt });
      if (was && !m.running) finished();
      syncTitle();
      syncComposer();
      break;
    }
    case 'reset':
      if (m.state) S.state = m.state; else if (S.state) S.state.log = [];
      if (S.tab === 'chat' && !S.page) render();
      break;
    case 'projects': refreshSoon(); break;
    case 'renamed':
      if (m.from in drafts) { drafts[m.to] = drafts[m.from]; delete drafts[m.from]; }
      if (S.project === m.from) {
        S.project = m.to;
        if (S.state) S.state.name = m.to;
        history.replaceState(null, '', S.page ? `#/${S.page}` : `#/p/${encodeURIComponent(m.to)}/${S.tab}`);
        syncTitle();
        const title = $main.querySelector('.top h1');
        if (title && !S.page) { title.textContent = pretty(m.to); title.title = pretty(m.to); }
      }
      refreshSoon();
      break;
    case 'agent': if (S.page === 'agents') refreshAgentsSoon(); break;
    case 'toast': toast(m.text); break;
  }
}

// ---- chat ----
let $log, $todos, $input, $sendBtn, $stopBtn, $mode, $autoBtn, $model, $modelLabel, $agentBtn, $agentLabel, $promptBtn, $meter, $thumbs, $slash;

function chatView(view) {
  entries.clear();
  $log = h('div', { class: 'log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  $log.addEventListener('touchstart', stopFollow, { passive: true });
  $log.addEventListener('wheel', stopFollow, { passive: true });
  $todos = h('div', { class: 'todos', hidden: true });
  if (S.state) {
    if (!S.state.log.length) $log.append(h('div', { class: 'empty', id: 'hello' }, h('h2', {}, 'What should we build?'),
      h('p', { class: 'mono' }, `~/projects/${S.project}`), h('p', {}, 'Type a request. / runs a command and @ points at a file.')));
    for (const e of S.state.log) upsertEntry(e, false);
  }
  view.append($log, $todos, composer());
  syncComposer();
  $log.scrollTop = $log.scrollHeight;
  if (matchMedia('(hover: hover)').matches) $input.focus();
}

let following = 0;
const stopFollow = () => { cancelAnimationFrame(following); following = 0; };
const nearBottom = () => following || $log.scrollHeight - $log.scrollTop - $log.clientHeight < 140;
// Ease toward the bottom, so streaming text glides rather than jumps a line at a time.
function scroll(stick) {
  if (!stick || following) return;
  if (calm.matches) { $log.scrollTop = $log.scrollHeight; return; }
  const step = () => {
    const gap = $log.isConnected ? $log.scrollHeight - $log.clientHeight - $log.scrollTop : 0;
    if (gap < 1) { following = 0; return; }
    $log.scrollTop += Math.ceil(gap * .22);
    following = requestAnimationFrame(step);
  };
  following = requestAnimationFrame(step);
}

function upsertEntry(e, follow = true) {
  if (!$log?.isConnected && follow) return;
  const stick = follow && nearBottom();
  document.getElementById('hello')?.remove();
  const el = renderEntry(e);
  const old = entries.get(e.id);
  // Keep an open fold open across status updates.
  if (old?.el.open) el.open = true;
  if (old) old.el.replaceWith(el); else $log.append(el);
  if (follow && !old) motion(el, RISE, 280);
  entries.set(e.id, { el, e });
  scroll(stick);
}

let mdPending = new Set();
function delta(m) {
  const rec = entries.get(m.id);
  const stick = $log?.isConnected && nearBottom();
  const logged = S.state?.log.find(x => x.id === m.id);
  if (m.kind === 'output') {
    if (logged) logged.output = (logged.output || '') + m.text;
    rec?.el.querySelector('.live')?.append(m.text);
  } else if (logged) {
    logged.text += m.text;
    if (rec) {
      if (!mdPending.size) requestAnimationFrame(() => {
        for (const id of mdPending) {
          const r = entries.get(id);
          const target = r?.el.querySelector('.md');
          if (target) { markdown(target, r.e.text, false); }
        }
        mdPending = new Set();
        if ($log?.isConnected && nearBottom()) scroll(true);
      });
      rec.e = logged;
      mdPending.add(m.id);
    }
  }
  scroll(stick);
}

const toolTarget = (n, a) => a.command ?? a.file_path ?? a.pattern ?? a.url ?? a.description ?? a.query ?? a.question ?? a.shell_id ?? a.name ?? (n === 'TodoWrite' ? `${a.todos?.length ?? 0} items` : '');

function diffBlock(oldS, newS) {
  return h('div', { class: 'out' },
    (oldS || '').split('\n').map(l => h('span', { class: 'del' }, `- ${l}`)),
    (newS || '').split('\n').map(l => h('span', { class: 'add' }, `+ ${l}`)));
}

function toolArgs(e) {
  const a = e.args || {};
  if (e.name === 'Edit') return diffBlock(a.old_string, a.new_string);
  if (e.name === 'Write') return h('div', { class: 'out' }, a.content);
  if (e.name === 'Bash') return h('div', { class: 'out' }, `$ ${a.command}`);
  if (e.name === 'Task') return h('div', { class: 'out' }, `${a.subagent_type || 'general-purpose'}: ${a.prompt}`);
  // The plan stays readable after approval, which is the only time anyone sees one autopilot approved.
  if (e.name === 'ExitPlanMode') { const md = h('div', { class: 'md plan' }); markdown(md, a.plan); return md; }
  if (e.name === 'TodoWrite' || e.name === 'AskUserQuestion') return null;
  return h('div', { class: 'out' }, JSON.stringify(a, null, 2));
}

function askBox(e) {
  const reply = value => { sendWs({ t: 'answer', id: e.id, value }); };
  if (e.kind === 'question') {
    const input = h('input', { class: 'field', placeholder: 'Your answer', 'aria-label': 'Your answer', onkeydown: ev => { if (ev.key === 'Enter' && input.value) reply({ answer: input.value }); } });
    return h('div', { class: 'ask' }, h('div', { class: 'q' }, e.args.question),
      h('div', { class: 'row' }, (e.args.options || []).map(o => h('button', { class: 'btn small', onclick: () => reply({ answer: o }) }, o))),
      input,
      h('div', { class: 'row' }, h('button', { class: 'btn small primary', onclick: () => input.value && reply({ answer: input.value }) }, 'Answer'), h('button', { class: 'btn small', onclick: () => reply({ decision: 'deny' }) }, 'Dismiss')));
  }
  if (e.kind === 'plan') {
    const plan = h('div', { class: 'md' });
    markdown(plan, e.args.plan);
    const fb = h('input', { class: 'field', placeholder: 'What should change? (optional)', 'aria-label': 'Plan feedback' });
    return h('div', { class: 'ask' }, plan, fb, h('div', { class: 'row' },
      h('button', { class: 'btn small primary', onclick: () => reply({ decision: 'allow', mode: 'acceptEdits' }) }, 'Approve, accept edits'),
      h('button', { class: 'btn small', onclick: () => reply({ decision: 'allow', mode: 'default' }) }, 'Approve, ask each time'),
      h('button', { class: 'btn small', onclick: () => reply({ decision: 'deny', message: fb.value }) }, 'Keep planning')));
  }
  const why = h('input', { class: 'field', placeholder: 'Tell the agent why, or what to do instead (optional)', 'aria-label': 'Reason for denying' });
  return h('div', { class: 'ask' }, e.agent ? h('div', { class: 'q small muted' }, `Requested by subagent: ${e.agent}`) : null,
    h('div', { class: 'q' }, `Allow ${e.name}?`), toolArgs(e), why, h('div', { class: 'row' },
      h('button', { class: 'btn small primary', onclick: () => reply({ decision: 'allow' }) }, 'Allow once'),
      h('button', { class: 'btn small', onclick: () => reply({ decision: 'always' }) }, e.name === 'Bash' ? 'Always allow this exact command' : 'Always allow'),
      h('button', { class: 'btn small danger', onclick: () => reply({ decision: 'deny', message: why.value }) }, 'Deny')));
}

function renderEntry(e) {
  switch (e.type) {
    case 'user': {
      const rw = !e.queued && e.cp !== undefined && h('button', { class: 'icon-btn rw', 'aria-label': 'Rewind to this prompt', title: 'Rewind to here', onclick: () => rewindDialog(e) }, icon('undo'));
      const tag = e.injected && h('span', { class: 'itag', title: 'Your standing instructions from Prompts were added to this message' }, '+ injected');
      return h('div', { class: `e user ${e.queued ? 'queued' : ''}` }, e.text, (e.images || []).map(src => h('img', { src, alt: 'Attachment' })), tag, rw);
    }
    case 'assistant': {
      const md = h('div', { class: 'md' });
      markdown(md, e.text, e.status !== 'running');
      return h('div', { class: 'e assistant' }, md);
    }
    case 'reasoning': {
      const md = h('div', { class: 'md small muted' });
      markdown(md, e.text, false);
      return h('details', { class: 'e fold reason' }, h('summary', {}, e.status === 'running' ? 'Thinking…' : 'Thought'), md);
    }
    case 'tool': {
      const awaiting = e.status === 'awaiting';
      const d = h('details', { class: 'e fold tool', open: awaiting || e.status === 'error' || e.direct || e.name === 'ExitPlanMode' || e.name === 'Screenshot' },
        h('summary', {}, h('span', { class: `dot ${e.status}`, title: e.status }),
          h('span', { class: 'tname' }, e.name), h('span', { class: 'targ muted' }, String(toolTarget(e.name, e.args || {})).split('\n')[0]),
          e.autopilot && h('span', { class: 'aptag', title: 'Autopilot answered this for you' }, 'autopilot'),
          e.agent && h('span', { class: 'tagent muted' }, e.agent)));
      if (awaiting) d.append(askBox(e));
      else {
        const args = toolArgs(e);
        if (args) d.append(args);
        if (e.images) d.append(...e.images.map(src => h('img', { class: 'seen', src, alt: 'The image the agent looked at' })));
        else if (e.status === 'running' || e.output) d.append(h('div', { class: 'out live' }, e.output || ''));
        if (e.status === 'denied') d.open = true;
      }
      return d;
    }
    case 'error': return h('div', { class: 'e error', role: 'alert' }, e.text);
    default: {
      const md = h('div', { class: 'md' });
      markdown(md, e.text);
      return h('div', { class: 'e system' }, md, e.detail ? h('details', { class: 'fold' }, h('summary', {}, 'Show summary'), h('div', { class: 'out' }, e.detail)) : null);
    }
  }
}

async function rewindDialog(e) {
  const choice = await dialog({ title: 'Rewind to this prompt?', body: h('div', {},
    h('div', { class: 'out' }, e.text),
    h('p', { class: 'muted small' }, 'Later messages are removed. A safety checkpoint of the current files is saved first. node_modules and .venv are not restored.')),
  actions: [{ label: 'Cancel' },
    { label: 'Conversation only', value: { files: false, conversation: true } },
    { label: 'Files only', value: { files: true, conversation: false } },
    { label: 'Files and conversation', class: 'primary', value: { files: true, conversation: true } }] });
  if (!choice) return;
  await guard(async () => {
    const { text } = await api('POST', `${P(S.project)}/rewind`, { id: e.id, ...choice });
    if (choice.conversation && $input) { $input.value = text; $input.focus(); }
    toast('Rewound.');
  })();
}

const BUILTIN = [
  ['help', 'Show commands and keys'], ['clear', 'Start over, archiving the transcript'], ['compact', 'Summarize to free up context'], ['autocompact', 'Turn auto-compact on or off, or set its size'],
  ['model', 'Show or set the model'], ['effort', 'low, medium, high, xhigh or max'], ['mode', 'default, acceptEdits, plan or bypass'], ['plan', 'Research only, then propose a plan'],
  ['cost', 'Show tokens used and cost'], ['budget', 'Dollars: stop once this chat has cost that much'], ['init', 'Write a NEXUS.md for this project'], ['review', 'Review this branch, or a pull request by number'], ['pr', 'Commit, push and open a GitHub pull request'], ['issue', 'Fix a GitHub issue by number'], ['schedule', 'Run a prompt on a timer: cron fields, then the prompt'], ['check', 'A command, like npm test, to run after each change; Nexus fixes failures'], ['todos', 'Show the task list'],
  ['files', 'Open the Files tab'], ['changes', 'Open the Changes tab'], ['terminal', 'Open the terminal'], ['agents', 'Open agent management'],
  ['skills', 'List skills and agents'], ['mcp', 'Open MCP and hook settings'], ['settings', 'Open settings'], ['memory', 'Edit NEXUS.md'], ['rewind', 'How to rewind'],
  ['create-agent', 'Have the AI write a new agent type'], ['agent', 'Switch this chat to another agent'], ['prompts', 'Edit system prompts and injected text'],
  ['marketplace', 'Browse agents and MCP servers to add'], ['export', 'Download this chat as Markdown'], ['autopilot', 'on or off: keep working without stopping to ask'],
];
const slashItems = () => [
  ...BUILTIN.map(([name, description]) => ({ name, description })),
  ...S.meta.commands, ...S.meta.skills,
];
function localCommand(text) {
  const cmd = text.slice(1).trim();
  if (['files', 'changes', 'terminal'].includes(cmd)) { go(S.project, null, cmd); return true; }
  if (['agents', 'skills'].includes(cmd)) { go(S.project, 'agents'); return true; }
  if (['settings', 'mcp'].includes(cmd)) { go(S.project, 'settings'); return true; }
  if (cmd === 'memory') { pendingOpen = 'NEXUS.md'; go(S.project, null, 'files'); return true; }
  if (cmd === 'rewind') { toast('Use the rewind arrow on the prompt you want to go back to.'); return true; }
  const panels = { agent: agentPicker, prompts: () => promptsDialog(), marketplace: () => openMarket('agents'), export: () => exportChat(S.project) };
  if (Object.hasOwn(panels, cmd)) { guard(panels[cmd])(); return true; }
  return false;
}

let slashIndex = 0;
function updateSlash() {
  const v = $input.value;
  const at = /(?:^|\s)@(\S*)$/.exec(v.slice(0, $input.selectionStart));
  $slash.dataset.mode = at ? '@' : '/';
  if (at) return suggestFiles(at[1]);
  fileHits.q = null;
  const m = /^\/(\S*)$/.exec(v);
  if (!m) { $slash.hidden = true; return; }
  const seen = new Set();
  const items = slashItems().filter(c => c.name.toLowerCase().startsWith(m[1].toLowerCase()) && !seen.has(c.name) && seen.add(c.name)).slice(0, 12);
  slashIndex = Math.min(slashIndex, Math.max(items.length - 1, 0));
  $slash.hidden = !items.length;
  $slash.replaceChildren(...items.map((c, i) => h('button', { class: i === slashIndex ? 'on' : '', type: 'button', onclick: () => { $input.value = `/${c.name} `; $slash.hidden = true; $input.focus(); } }, h('b', {}, `/${c.name}`), h('span', {}, c.argumentHint ? `${c.argumentHint} — ${c.description}` : c.description))));
}

// @ suggests project files; picking one puts its path in the message, where the model reads it as a pointer to that file.
let fileHits = { q: null, files: [] };
async function suggestFiles(q) {
  if (fileHits.q !== q) {
    fileHits = { q, files: fileHits.files };
    const files = await api('GET', `${P(S.project)}/files?q=${encodeURIComponent(q)}`).catch(() => []);
    if (fileHits.q !== q) return; // a newer keystroke won
    fileHits.files = files;
  }
  const { files } = fileHits;
  slashIndex = Math.min(slashIndex, Math.max(files.length - 1, 0));
  $slash.hidden = !files.length;
  $slash.replaceChildren(...files.map((f, i) => h('button', { class: i === slashIndex ? 'on' : '', type: 'button', onclick: () => {
    const caret = $input.selectionStart, head = $input.value.slice(0, caret).replace(/@\S*$/, `@${f} `);
    $input.value = head + $input.value.slice(caret);
    drafts[S.project] = $input.value;
    $slash.hidden = true;
    $input.focus();
    $input.setSelectionRange(head.length, head.length);
  } }, h('b', {}, f.slice(f.lastIndexOf('/') + 1)), h('span', {}, f))));
}

function send() {
  const text = $input.value.trim();
  if (!text && !S.images.length) return;
  if (S.ws?.readyState !== 1) { toast('Not connected. Your message is still here, so send it once you are back.'); return; }
  $slash.hidden = true;
  dictation?.abort();
  delete drafts[S.project];
  if (text.startsWith('/') && localCommand(text)) { $input.value = ''; grow(); return; }
  sendWs({ t: 'send', text, images: S.images.length ? S.images : undefined });
  $input.value = '';
  grow();
  S.images = [];
  syncThumbs();
}
function addFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) { toast(`${f.name} is not an image. Save other files into the project from the terminal.`); continue; }
    if (f.size > 15_000_000) { toast(`${f.name} is over 15 MB.`); continue; }
    const r = new FileReader();
    r.onload = () => { S.images.push(r.result); syncThumbs(); };
    r.readAsDataURL(f);
  }
}
function syncThumbs() {
  $thumbs.hidden = !S.images.length;
  $thumbs.replaceChildren(...S.images.map((src, i) => h('button', { type: 'button', 'aria-label': 'Remove attachment', title: 'Remove', onclick: () => { S.images.splice(i, 1); syncThumbs(); } }, h('img', { src, alt: '' }))));
}

const MODES = [['default', 'Ask first'], ['acceptEdits', 'Accept edits'], ['plan', 'Plan'], ['bypass', 'Bypass']];
const setMode = async value => {
  if (value === 'bypass' && !await confirmBox('Turn on bypass mode?', 'The agent will run every command and change any file on this machine without asking.', 'Turn on', 'danger')) return syncComposer();
  sendWs({ t: 'option', key: 'mode', value });
};
const toggleAutopilot = async () => {
  if (!S.state.autopilot && !await confirmBox('Turn on autopilot?', `The agent stops asking you. It runs commands and edits files without approval, approves its own plan in plan mode, and answers its own questions, until the task is done or it has made 150 model requests. Plan mode still can't change anything before the plan. Stop works as usual.`, 'Turn on', 'danger')) return;
  setOption('autopilot', !S.state.autopilot);
};

// Dictation types what you say into the message box, using the browser's own speech recognition (Chrome, Edge and Safari; Firefox has none, so the button hides).
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
let dictation = null;
function dictate(btn) {
  if (dictation) { dictation.stop(); return; }
  const rec = dictation = new Speech();
  const before = $input.value.trim() ? `${$input.value.trimEnd()} ` : '';
  const mark = on => { btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on)); };
  Object.assign(rec, { lang: navigator.language, interimResults: true, continuous: true });
  rec.onresult = e => {
    $input.value = before + Array.from(e.results, r => r[0].transcript).join('');
    drafts[S.project] = $input.value;
    grow();
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('The microphone is blocked. Allow it for this site; browsers only offer it over https or on localhost.');
    else if (e.error !== 'aborted' && e.error !== 'no-speech') toast(`Dictation stopped: ${e.error}.`);
  };
  rec.onend = () => { if (dictation === rec) dictation = null; mark(false); };
  rec.start();
  mark(true);
}

// Reconnects rebuild the composer, and iOS reconnects often, so drafts live outside it.
let drafts = {};
try { drafts = JSON.parse(localStorage.getItem('nexus.drafts')) || {}; } catch { /* starts empty */ }
function saveDrafts() { try { localStorage.setItem('nexus.drafts', JSON.stringify(drafts)); } catch { /* private window */ } }
addEventListener('pagehide', saveDrafts);
const grow = () => { if (!CSS.supports('field-sizing', 'content')) { $input.style.height = 'auto'; $input.style.height = `${$input.scrollHeight}px`; } };
function composer() {
  $input = h('textarea', { rows: 1, placeholder: 'Message Nexus', 'aria-label': 'Message', oninput: () => { drafts[S.project] = $input.value; grow(); updateSlash(); },
    onpaste: e => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); addFiles(f); } },
    onkeydown: e => {
      if (!$slash.hidden) {
        const items = [...$slash.children];
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); slashIndex = (slashIndex + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; updateSlash(); return; }
        if (e.key === 'Tab' || (e.key === 'Enter' && $slash.dataset.mode === '@')) { e.preventDefault(); items[slashIndex].click(); return; }
        if (e.key === 'Escape') { $slash.hidden = true; return; }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !touch.matches) { e.preventDefault(); send(); } else if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        const cycle = ['default', 'acceptEdits', 'plan'];
        sendWs({ t: 'option', key: 'mode', value: cycle[(cycle.indexOf(S.state?.mode) + 1) % 3] });
      } else if (e.key === 'Escape' && S.state?.running) sendWs({ t: 'interrupt' });
    } });
  $input.value = drafts[S.project] || '';
  $thumbs = h('div', { class: 'thumbs', hidden: true });
  $slash = h('div', { class: 'slash', hidden: true });
  const file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: () => { addFiles(file.files); file.value = ''; } });
  $mode = h('select', { 'aria-label': 'Permission mode', title: 'Permission mode (Shift+Tab)', onchange: () => setMode($mode.value) }, MODES.map(([v, l]) => h('option', { value: v }, l)));
  $autoBtn = h('button', { class: 'icon-btn apbtn', type: 'button', 'aria-label': 'Autopilot', onclick: guard(toggleAutopilot) }, icon('plane'));
  $agentLabel = h('span', { class: 'mlabel' });
  $agentBtn = h('button', { class: 'mbtn abtn', type: 'button', 'aria-label': 'Choose the agent for this chat', onclick: guard(agentPicker) }, icon('bot'), $agentLabel, icon('down'));
  $promptBtn = h('button', { class: 'icon-btn pbtn', type: 'button', 'aria-label': 'System prompts and injected text', title: 'Prompts', onclick: guard(() => promptsDialog()) }, icon('sliders'));
  $modelLabel = h('span', { class: 'mlabel' });
  $model = h('button', { class: 'mbtn', type: 'button', 'aria-label': 'Choose model and effort', title: 'Model and effort', onclick: modelPicker }, $modelLabel, icon('down'));
  $meter = h('button', { class: 'meter', type: 'button', onclick: tokenPanel });
  $sendBtn = h('button', { class: 'btn small primary', onmousedown: e => e.preventDefault(), onclick: send }, 'Send');
  $stopBtn = h('button', { class: 'btn small danger', hidden: true, onclick: () => sendWs({ t: 'interrupt' }) }, 'Stop');
  syncThumbs();
  return h('div', { class: 'composer' }, $slash, h('div', { class: 'cbox' }, $thumbs, $input, h('div', { class: 'cbar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Attach image', title: 'Attach image', onclick: () => file.click() }, icon('clip')), file,
    Speech && h('button', { class: 'icon-btn mic', type: 'button', 'aria-label': 'Dictate', 'aria-pressed': 'false', title: "Dictate: speak and it types (your browser's speech recognition)", onclick: e => dictate(e.currentTarget) }, icon('mic')),
    $mode, $autoBtn, $agentBtn, $model, $promptBtn, $meter, $stopBtn, $sendBtn)));
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Price per million tokens, input and output; OpenRouter marks routers with a negative price.
const isFree = m => m.price?.length === 2 && m.price.every(p => p === 0);
const priceText = m => (m.price?.every(p => p >= 0) && !isFree(m) ? `$${+m.price[0].toFixed(2)} in · $${+m.price[1].toFixed(2)} out per M` : '');
const tokens = n => (n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}K`);
function setOption(key, value) {
  S.state[key] = value;
  sendWs({ t: 'option', key, value });
  syncComposer();
}

function modelPicker() {
  const shut = () => {
    d.classList.add('closing');
    exit(d, { opacity: 0, transform: phone.matches ? 'translateY(32px)' : 'scale(.97)' }).then(() => d.close());
  };
  const pick = m => {
    setOption('model', m.id);
    // Keep the effort the user chose unless the new model can't do it, then take the next one down.
    if (m.efforts.length && !m.efforts.includes(S.state.effort)) setOption('effort', m.efforts.filter(l => EFFORTS.indexOf(l) < EFFORTS.indexOf(S.state.effort)).at(-1) || m.efforts[0]);
    shut();
  };
  const row = m => {
    const current = m.id === S.state.model;
    const facts = [m.id, m.context && `${tokens(m.context)} context`, m.maxOutput && `${tokens(m.maxOutput)} output`, priceText(m)].filter(Boolean).join(' · ');
    return h('button', { class: `mrow${current ? ' current' : ''}`, type: 'button', autofocus: current && touch.matches, 'aria-current': current ? 'true' : null, onclick: () => pick(m) },
      h('span', { class: 'mtext' },
        h('span', { class: 'mname' }, m.name, m.id === S.me?.defaultModel && h('span', { class: 'mtag' }, 'Default'), m.deprecated && h('span', { class: 'mtag old' }, 'Deprecated'), isFree(m) && h('span', { class: 'mtag free' }, 'Free')),
        h('span', { class: 'mfacts' }, facts)),
      current && icon('check'));
  };
  const list = h('div', { class: 'mlist' });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Effort' });
  const fx = h('span', { class: 'sfx' });
  const foot = h('div', { class: 'mfoot' }, h('span', { class: 'muted' }, 'Effort'), seg);
  const renderEffort = () => {
    const levels = S.models.find(m => m.id === S.state.model)?.efforts ?? EFFORTS.slice(0, 4);
    foot.hidden = !levels.length;
    seg.style.setProperty('--n', levels.length);
    seg.style.setProperty('--i', Math.max(0, levels.indexOf(S.state.effort)));
    seg.dataset.level = S.state.effort;
    seg.replaceChildren(fx, ...levels.map(l => h('button', { type: 'button', class: l === S.state.effort ? 'on' : '', 'aria-pressed': String(l === S.state.effort), onclick: () => { setOption('effort', l); renderEffort(); } }, l)));
  };
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Search models', 'aria-label': 'Search models', autocomplete: 'off', oninput: () => render(),
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); list.querySelector('.mrow')?.click(); } } });
  const render = () => {
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const known = S.models.some(m => m.id === S.state.model) ? S.models : [{ id: S.state.model, name: S.state.model, provider: 'other', efforts: EFFORTS.slice(0, 4) }, ...S.models];
    const found = known.filter(m => terms.every(t => `${m.name} ${m.id} ${m.providerName || ''} ${isFree(m) ? 'free' : ''}`.toLowerCase().includes(t)));
    const groups = new Map([...S.models.map(m => [m.provider, m.providerName || m.provider]), ['other', 'Current']]);
    list.replaceChildren(...[...groups].flatMap(([id, label]) => {
      const rows = found.filter(m => m.provider === id);
      return rows.length ? [h('h3', {}, label), ...rows.map(row)] : [];
    }));
    if (!found.length) list.append(h('p', { class: 'mnone muted' }, S.models.length ? `No models match "${search.value}".` : 'Loading models.'));
  };
  const d = h('dialog', { class: 'picker', 'aria-label': 'Choose model',
    onclick: e => { if (e.target === d) shut(); },
    oncancel: e => { e.preventDefault(); shut(); },
    onclose: () => d.remove(),
    onkeydown: e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const rows = [search, ...list.querySelectorAll('.mrow')];
      rows[(rows.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length].focus();
    } },
    h('div', { class: 'mhead' }, h('h2', {}, 'Model'), h('button', { class: 'btn small', type: 'button', onclick: shut }, 'Done')),
    search, list, foot);
  render();
  renderEffort();
  document.body.append(d);
  d.showModal();
  if (!touch.matches) search.focus();
  const current = list.querySelector('.current');
  if (current) list.scrollTop = current.offsetTop - list.clientHeight / 2;
}

let syncTokens = null;
function tokenPanel() {
  const shut = () => {
    d.classList.add('closing');
    exit(d, { opacity: 0, transform: 'scale(.97)' }).then(() => d.close());
  };
  const row = (label, value) => h('div', {}, h('span', { class: 'muted' }, label), h('b', {}, value));
  const stats = h('div', { class: 'tstats' });
  const fill = h('i');
  const focus = h('input', { class: 'field', placeholder: 'What to keep (optional)', 'aria-label': 'What to keep when compacting', onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); run.click(); } } });
  const run = h('button', { class: 'btn primary', type: 'button', onclick: () => { sendWs({ t: 'send', text: `/compact ${focus.value}`.trim() }); shut(); } }, 'Compact now');
  const auto = h('button', { class: 'btn', type: 'button', onclick: () => sendWs({ t: 'send', text: `/autocompact ${S.state.compactAt ? 'off' : 'on'}` }) });
  const autoText = h('span', {});
  const budget = h('input', { class: 'field', type: 'number', min: '0', step: 'any', inputmode: 'decimal', placeholder: 'None', 'aria-label': 'Budget in dollars', title: 'The agent stops once this chat has cost this much',
    onchange: () => setOption('budget', Math.max(0, Number(budget.value) || 0)) });
  syncTokens = () => {
    const { usage: u, compactAt: at, running } = S.state;
    if (document.activeElement !== budget) budget.value = S.state.budget || '';
    const last = u.lastInput || 0;
    fill.style.width = `${at ? Math.min(100, last / at * 100) : 0}%`;
    stats.replaceChildren(
      row('Context', at ? `${fmt(last)} of ${fmt(at)}` : fmt(last)),
      row('Cached last request', last ? `${Math.round((u.lastCached || 0) / last * 100)}%` : 'None yet'),
      row('Total input', `${fmt(u.input)} (${fmt(u.cached)} cached)`),
      row('Total output', fmt(u.output)),
      row('Cost', `${u.cost || !u.unpriced ? usd(u.cost) : 'Unknown'}${u.cost && u.unpriced ? ` + ${u.unpriced} unpriced requests` : ''}`));
    autoText.textContent = at ? `Auto-compact is on, at ${fmt(at)}` : 'Auto-compact is off';
    auto.textContent = at ? 'Turn off' : 'Turn on';
    run.disabled = running;
    run.title = running ? 'Stop the agent first' : '';
  };
  const d = h('dialog', { class: 'tokens', 'aria-label': 'Tokens and compacting',
    onclick: e => { if (e.target === d) shut(); },
    oncancel: e => { e.preventDefault(); shut(); },
    onclose: () => { syncTokens = null; d.remove(); } },
    h('div', { class: 'mhead' }, h('h2', {}, 'Tokens'), h('button', { class: 'btn small', type: 'button', onclick: shut }, 'Done')),
    h('div', { class: 'tbody' }, h('div', { class: 'tbar' }, fill), stats,
      h('div', { class: 'tauto' }, h('span', {}, 'Budget for this chat, $'), budget),
      h('div', { class: 'tauto' }, autoText, auto), focus, run));
  syncTokens();
  document.body.append(d);
  d.showModal();
}

function syncComposer() {
  const st = S.state;
  if (!st || !$input?.isConnected) return;
  $mode.value = st.mode;
  $mode.className = st.mode;
  $autoBtn.classList.toggle('on', Boolean(st.autopilot));
  $autoBtn.setAttribute('aria-pressed', String(Boolean(st.autopilot)));
  $autoBtn.title = st.autopilot ? 'Autopilot is on: the agent decides without asking. Click to turn it off.' : 'Autopilot: let the agent finish without stopping to ask';
  const info = S.models.find(m => m.id === st.model);
  $modelLabel.textContent = (info?.name || st.model) + (info?.efforts.length === 0 ? '' : ` · ${st.effort}`);
  const role = st.agent && S.meta.agents.find(a => a.name === st.agent);
  $agentLabel.textContent = st.agent || 'Nexus';
  $agentBtn.classList.toggle('on', Boolean(st.agent));
  $agentBtn.title = st.agent ? `Agent: ${st.agent}${role?.description ? `. ${role.description}` : ''}` : 'Agent: Nexus, the default';
  const p = S.prompts;
  $promptBtn.classList.toggle('on', Boolean(p && [p.chat, p.project, p.global].some(x => x.system.trim() || x.inject.trim())));
  $stopBtn.hidden = !st.running;
  $sendBtn.textContent = st.running ? 'Queue' : 'Send';
  $meter.replaceChildren(`${fmt(st.usage.lastInput)} / ${st.compactAt ? fmt(st.compactAt) : 'off'}`, st.usage.cost ? h('span', { class: 'mcost' }, ` · ${usd(st.usage.cost)}`) : '');
  $meter.title = $meter.ariaLabel = 'Tokens, cost and compacting';
  syncTokens?.();
  $todos.hidden = !st.todos?.length || st.todos.every(t => t.status === 'completed');
  $todos.replaceChildren(...(st.todos || []).map(t => h('div', { class: t.status }, h('span', {}, t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '○'), t.content)));
}

let uidN = 0;
const uid = () => `u${++uidN}`;
const sheet = d => () => { d.classList.add('closing'); exit(d, { opacity: 0, transform: phone.matches ? 'translateY(32px)' : 'scale(.97)' }).then(() => d.close()); };
const projectForInstall = () => S.project || S.projects[0]?.name;
const extLink = (label, url) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, label, icon('ext'));

// ---- the chat's agent ----
// Like the model picker: the default, every custom agent type, and ways to get more.
async function agentPicker() {
  if (!S.project || !S.state) return toast('Open a project first.');
  const pick = def => {
    setOption('agent', def?.name || '');
    if (def?.model) setOption('model', def.model);
    shut(); // the chat log shows the switch
  };
  const row = def => {
    const current = (def?.name || '') === (S.state.agent || '');
    const facts = def ? [def.description || 'No description', def.tools ? `tools: ${def.tools.join(', ')}` : '', def.model].filter(Boolean).join(' · ') : 'The built-in coding agent, with every tool.';
    return h('button', { class: `mrow${current ? ' current' : ''}`, type: 'button', 'aria-current': current ? 'true' : null, onclick: () => pick(def) },
      h('span', { class: 'mtext' },
        h('span', { class: 'mname' }, def ? def.name : 'Nexus', !def && h('span', { class: 'mtag' }, 'Default'), def && h('span', { class: 'mtag dim' }, def.scope === 'user' ? 'All projects' : 'This project')),
        h('span', { class: 'mfacts' }, facts)),
      current && icon('check'));
  };
  const list = h('div', { class: 'mlist' });
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Search agents', 'aria-label': 'Search agents', autocomplete: 'off', oninput: () => fill(),
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); list.querySelector('.mrow')?.click(); } } });
  const fill = () => {
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const defs = S.meta.agents.filter(a => !a.builtin && terms.every(t => `${a.name} ${a.description}`.toLowerCase().includes(t)));
    list.replaceChildren(row(null), ...defs.map(row),
      ...(defs.length || terms.length ? [] : [h('p', { class: 'mnone muted' }, 'No custom agents yet. Create one with AI, or install one of 120+ from the marketplace.')]));
  };
  const d = h('dialog', { class: 'picker', 'aria-label': 'Choose agent', onclick: e => { if (e.target === d) shut(); }, oncancel: e => { e.preventDefault(); shut(); }, onclose: () => d.remove() },
    h('div', { class: 'mhead' }, h('h2', {}, 'Agent'), h('button', { class: 'btn small', type: 'button', onclick: () => shut() }, 'Done')),
    search, list,
    h('div', { class: 'mfoot afoot' },
      h('button', { class: 'btn small', type: 'button', onclick: () => { shut(); createWithAI(); } }, icon('spark'), 'Create with AI'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { shut(); openMarket('agents'); } }, icon('grid'), 'Marketplace'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { shut(); go(S.project, 'agents'); } }, 'Manage')));
  const shut = sheet(d);
  fill();
  document.body.append(d);
  d.showModal();
  if (!touch.matches) search.focus();
  await loadMeta().catch(() => {}); // picks up agent types the AI just wrote
  if (d.open) fill();
}

// /create-agent runs as a normal prompt, so the agent can read the project and its file write is shown for approval.
function createWithAI(about = '') {
  const project = projectForInstall();
  if (!project) return toast('Create a project first.');
  drafts[project] = `/create-agent ${about}`;
  if (S.project !== project || S.page || S.tab !== 'chat') go(project, null, 'chat');
  else if ($input?.isConnected) { $input.value = drafts[project]; grow(); }
  $input?.focus();
  toast('Say what the agent should do after /create-agent, then send.');
}

// ---- prompts ----
const PROMPT_SCOPES = [['chat', 'This chat'], ['project', 'Project'], ['global', 'Everywhere']];
const PROMPT_HINTS = {
  chat: 'Only this conversation. /clear resets it.',
  project: 'Every chat in this project. Saved in its .nexus folder, so it survives /clear.',
  global: "Rewrites Nexus's own instructions in every chat. The project details, agents, skills and NEXUS.md are always added after it.",
};

async function promptsDialog(scope = 'chat') {
  if (!S.project) return toast('Open a project first.');
  const data = await api('GET', `${P(S.project)}/prompts`);
  const saved = { chat: data.chat, project: data.project, global: { ...data.global, system: data.global.system || data.defaultBase } };
  const draft = structuredClone(saved);
  const [sid, iid] = [uid(), uid()];
  const system = h('textarea', { class: 'field ptext', id: sid, spellcheck: false });
  const inject = h('textarea', { class: 'field ptext short-h', id: iid, spellcheck: false, placeholder: 'For example: keep replies under 150 words, and always run the tests.' });
  const sysLabel = h('label', { class: 'lbl', htmlFor: sid });
  const hint = h('p', { class: 'small muted', style: 'margin:0' });
  const reset = h('button', { class: 'btn small', type: 'button', onclick: () => { system.value = data.defaultBase; } }, 'Reset to default');
  const tabs = h('div', { class: 'seg2', role: 'tablist', 'aria-label': 'Where the prompt applies' });
  const err = h('div', { class: 'err', role: 'alert' });
  let shown = null;
  const show = id => {
    if (shown) draft[shown] = { system: system.value, inject: inject.value };
    shown = id;
    system.value = draft[id].system; inject.value = draft[id].inject;
    sysLabel.textContent = { chat: 'Added to the system prompt for this chat', project: `Added to the system prompt for every chat in ${pretty(S.project)}`, global: 'Base system prompt' }[id];
    system.placeholder = id === 'global' ? '' : id === 'project' ? 'For example: this is a Rust workspace; run cargo clippy before you finish.' : 'For example: answer in French, and explain each change before you make it.';
    hint.textContent = PROMPT_HINTS[id];
    reset.hidden = id !== 'global';
    tabs.replaceChildren(...PROMPT_SCOPES.map(([s, label]) => h('button', { type: 'button', role: 'tab', class: s === id ? 'on' : '', 'aria-selected': String(s === id), onclick: () => show(s) }, label)));
  };
  const save = async () => {
    draft[shown] = { system: system.value, inject: inject.value };
    for (const [s] of PROMPT_SCOPES) {
      if (draft[s].system !== saved[s].system || draft[s].inject !== saved[s].inject) await api('PUT', `${P(S.project)}/prompts`, { scope: s, ...draft[s] });
    }
    S.prompts = await api('GET', `${P(S.project)}/prompts`);
    syncComposer();
    toast('Saved. Prompts apply from your next message.');
  };
  show(scope);
  dialog({ title: 'Prompts', wide: true,
    body: h('div', { class: 'form' }, tabs, hint,
      h('div', {}, h('div', { class: 'rowline', style: 'margin-bottom:4px' }, h('span', { class: 'grow' }, sysLabel), reset), system),
      h('div', {}, h('label', { class: 'lbl', htmlFor: iid }, 'Injected into every message you send'), inject),
      h('p', { class: 'small muted', style: 'margin:0' }, 'Injected text rides along with each of your messages, where models weigh it most. Those messages show a small "+ injected" tag.'), err),
    actions: [{ label: 'Preview full prompt', run: async () => { await guard(previewPrompt)(); return false; } }, { label: 'Cancel' },
      { label: 'Save', class: 'primary', run: async () => { try { await save(); } catch (e) { err.textContent = e.message; return false; } } }] });
}

async function previewPrompt() {
  const { text } = await api('GET', `${P(S.project)}/prompts/preview`);
  dialog({ title: 'Full system prompt, as saved', wide: true, body: h('div', { class: 'out', style: 'max-height:62vh' }, text),
    actions: [{ label: 'Copy', run: async () => { await copyText(text); toast('Copied.'); return false; } }, { label: 'Close', class: 'primary' }] });
}

async function globalPromptsCard() {
  const data = await api('GET', '/api/prompts').catch(() => null);
  if (!data) return [];
  const system = h('textarea', { class: 'field ptext', id: 'gps', spellcheck: false, value: data.global.system || data.defaultBase });
  const inject = h('textarea', { class: 'field ptext short-h', id: 'gpi', spellcheck: false, value: data.global.inject, placeholder: 'For example: keep replies under 150 words.' });
  const err = h('div', { class: 'err', role: 'alert' });
  return [h('h2', {}, 'System prompt'),
    h('p', { class: 'small muted' }, "Nexus's own instructions, for every chat. Chats and projects can add their own from the Prompts button next to the model."),
    h('div', { class: 'form' }, h('div', {}, h('label', { class: 'lbl', htmlFor: 'gps' }, 'Base system prompt'), system),
      h('div', {}, h('label', { class: 'lbl', htmlFor: 'gpi' }, 'Injected into every message, in every chat'), inject), err,
      h('div', { class: 'rowline' },
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          err.textContent = '';
          try { await api('PUT', '/api/prompts', { system: system.value, inject: inject.value }); toast('Saved.'); } catch (e) { err.textContent = e.message; }
        } }, 'Save'),
        h('button', { class: 'btn', type: 'button', onclick: () => { system.value = data.defaultBase; } }, 'Reset to default')))];
}

// ---- marketplace ----
// A page like VS Code's Extensions view: the list beside the selected item on a wide screen, one at a time below that.
// Hand-picked agents and servers that ship with Nexus, aiagentslist.com, Hugging Face, and what is already installed.
const openMarket = kind => { S.marketKind = kind; go(S.project, 'marketplace'); };
const backBtn = back => h('div', { class: 'dhead' }, h('button', { class: 'btn small', type: 'button', onclick: back }, icon('back'), 'Back'));

function marketPage(hamb) {
  let kind = S.marketKind || 'agents', source = 'nexus', items = [], category = '', picked = '', seq = 0, openSeq = 0, timer;
  const srcs = {};
  const kinds = h('div', { class: 'seg2', role: 'tablist', 'aria-label': 'What to browse' });
  const sources = h('div', { class: 'seg2 msrc', role: 'tablist', 'aria-label': 'Source' });
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Search', 'aria-label': 'Search the marketplace', autocomplete: 'off',
    oninput: () => { clearTimeout(timer); timer = setTimeout(load, 350); } });
  const chips = h('div', { class: 'mchips', hidden: true });
  const grid = h('div', { class: 'mgrid' });
  const links = h('div', { class: 'mlinks small muted' });
  const detail = h('div', { class: 'mdetail' });
  const page = h('div', { class: 'mpage' }, h('div', { class: 'mside' }, h('div', { class: 'mtop' }, kinds, sources, search, chips), grid, links), detail);
  $main.replaceChildren(h('header', { class: 'top' }, hamb, h('h1', {}, 'Marketplace')), h('div', { class: 'view' }, page));
  const back = () => page.classList.remove('showing');
  const placeholder = () => detail.replaceChildren(h('p', { class: 'mnone muted' }, kind === 'mcp' ? 'Pick a server to see what it does and add it.' : 'Pick an agent to see what it does and install it.'));
  const tab = (on, label, click) => h('button', { type: 'button', role: 'tab', class: on ? 'on' : '', 'aria-selected': String(on), onclick: click }, label);
  const renderTabs = () => {
    kinds.replaceChildren(...[['agents', 'Agents'], ['mcp', 'MCP servers']].map(([k, label]) => tab(k === kind, label, () => {
      if (k !== kind) { kind = S.marketKind = k; source = 'nexus'; category = ''; back(); placeholder(); load(); }
    })));
    sources.replaceChildren(...[...srcs[kind] || [['nexus', 'Nexus picks']], ['installed', 'Installed']].map(([id, label]) => tab(id === source, label, () => {
      if (id !== source) { source = id; category = ''; load(); }
    })));
  };
  const renderGrid = () => {
    const cats = [...new Set(items.map(i => i.category).filter(Boolean))];
    chips.hidden = source !== 'nexus' || cats.length < 3;
    chips.replaceChildren(...['', ...cats].map(c => h('button', { type: 'button', class: `mchip${c === category ? ' on' : ''}`, 'aria-pressed': String(c === category), onclick: () => { category = c; renderGrid(); } }, c || 'All')));
    const shown = items.filter(i => !category || i.category === category);
    const empty = search.value.trim() ? `Nothing matches "${search.value.trim()}".` : source === 'installed' ? 'Nothing installed yet.' : 'Nothing here.';
    grid.replaceChildren(...(shown.length ? shown.map(tile) : [h('p', { class: 'mnone muted' }, empty)]));
    grid.scrollTop = 0;
  };
  const tile = it => h('div', { class: `tile${`${source}:${it.id}` === picked ? ' on' : ''}`, 'data-key': `${source}:${it.id}` },
    h('button', { class: 'tmain', type: 'button', onclick: () => open(it) },
      h('span', { class: 'ticon', 'aria-hidden': 'true' }, it.icon || (it.name[0] || '?').toUpperCase()),
      h('span', { class: 'ttext' },
        h('span', { class: 'tname' }, h('b', {}, it.name), it.featured && h('span', { class: 'mtag' }, 'Featured'), it.running === false && h('span', { class: 'mtag old' }, 'Asleep')),
        h('span', { class: 'tmeta' }, [it.author && `by ${it.author}`, it.category, it.stats].filter(Boolean).join(' · ')),
        h('span', { class: 'tdesc' }, it.description || 'No description.'))),
    h('button', { class: `btn small${it.installable ? ' primary' : ''}`, type: 'button', onclick: () => open(it) }, source === 'installed' ? 'Manage' : it.installable ? 'Install' : 'View'));
  async function load() {
    const mine = ++seq;
    renderTabs();
    grid.replaceChildren(h('p', { class: 'mnone muted' }, 'Loading…'));
    try {
      const q = search.value.trim();
      const res = source === 'installed' ? { items: await installedItems(kind, q) } : await api('GET', `/api/market?kind=${kind}&source=${source}&q=${encodeURIComponent(q)}`);
      if (mine !== seq) return;
      items = res.items;
      if (res.sources) {
        srcs[kind] = res.sources;
        links.replaceChildren('Browse online: ', ...res.links.flatMap(([label, url], i) => [i ? ' · ' : '', extLink(label, url)]));
      }
      renderTabs();
      renderGrid();
    } catch (e) {
      if (mine === seq) grid.replaceChildren(h('p', { class: 'mnone err' }, e.message));
    }
  }
  const open = async it => {
    const [mine, k, src] = [++openSeq, kind, source];
    picked = `${src}:${it.id}`;
    grid.querySelectorAll('.tile').forEach(t => t.classList.toggle('on', t.dataset.key === picked));
    page.classList.add('showing');
    detail.replaceChildren(h('p', { class: 'mnone muted' }, 'Loading…'));
    detail.scrollTop = 0;
    try {
      const parts = src === 'installed' ? installedDetail(it, k, back, load)
        : marketDetail({ ...it, ...await api('GET', `/api/market/item?kind=${k}&source=${src}&id=${encodeURIComponent(it.id)}`) }, k, back);
      if (mine === openSeq) detail.replaceChildren(...parts.flat(Infinity).filter(Boolean));
    } catch (e) {
      if (mine === openSeq) detail.replaceChildren(backBtn(back), h('p', { class: 'err' }, e.message));
    }
  };
  placeholder();
  if (!touch.matches) search.focus();
  load();
}

// What is already installed, shaped like marketplace items. Agents are the custom types of the project installs go to.
async function installedItems(kind, q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = it => terms.every(t => `${it.name} ${it.description}`.toLowerCase().includes(t));
  if (kind === 'mcp') {
    const { mcp } = await api('GET', '/api/settings');
    return mcp.map(s => ({ id: s.name, name: s.name, description: s.error || `${s.remote ? 'Remote · ' : ''}${s.status} · ${s.tools.length} tools`, server: s })).filter(match);
  }
  const project = projectForInstall();
  const { agents } = project ? await api('GET', `${P(project)}/meta`) : { agents: [] };
  return agents.filter(a => !a.builtin).map(a => ({ id: a.name, name: a.name, description: a.description, category: a.scope === 'user' ? 'All projects' : 'This project', def: a })).filter(match);
}

function installedDetail(it, kind, back, reload) {
  const remove = (why, run) => h('button', { class: 'btn danger', type: 'button', onclick: guard(async () => {
    if (!await confirmBox(`Remove ${it.name}?`, why, 'Remove', 'danger')) return;
    await run();
    toast(`Removed ${it.name}.`);
    back();
    reload();
  }) }, 'Remove');
  const head = [backBtn(back),
    h('div', { class: 'dtitle' }, h('span', { class: 'ticon big', 'aria-hidden': 'true' }, it.name[0].toUpperCase()),
      h('div', { class: 'grow' }, h('h3', {}, it.name), it.category && h('div', { class: 'small muted' }, it.category))),
    it.description && h('p', {}, it.description)];
  if (kind === 'mcp') {
    return [...head, h('div', { class: 'small muted' }, `Tools: ${it.server.tools.join(', ') || 'none yet'}`),
      h('div', { class: 'acts' }, remove('Its tools disappear from new messages. You can add it again from the marketplace.', () => api('DELETE', `/api/mcp-servers/${encodeURIComponent(it.name)}`)))];
  }
  const d = it.def, project = projectForInstall();
  const use = () => { setOption('agent', d.name); toast(`This chat now works as ${d.name}.`); };
  return [...head, h('div', { class: 'small muted' }, `Tools: ${d.tools?.join(', ') || 'every tool'}${d.model ? ` · ${d.model}` : ''}`),
    h('details', { class: 'fold' }, h('summary', {}, 'Read its instructions', icon('down')), h('div', { class: 'out' }, d.prompt)),
    h('div', { class: 'acts' },
      remove('This removes the agent type from Nexus folders. Types in other folders stay.', () => api('DELETE', `${P(project)}/agent-defs/${encodeURIComponent(d.name)}`)),
      h('button', { class: 'btn', type: 'button', onclick: () => editDef(project, d) }, 'Edit'),
      S.project === project && S.state && h('button', { class: 'btn primary', type: 'button', onclick: use }, 'Use in this chat'))];
}

// The form for one MCP server: its settings as editable JSON, plus fields for the secrets it needs.
function serverForm(s) {
  const [nid, cid] = [uid(), uid()];
  const name = h('input', { class: 'field mono', id: nid, value: s.name, spellcheck: false, autocapitalize: 'off' });
  const conf = h('textarea', { class: 'field mono cfg', id: cid, spellcheck: false, value: JSON.stringify(s.config, null, 2) });
  const asks = (s.inputs || []).map(i => {
    const id = uid();
    return { i, id, el: h('input', { class: 'field', id, type: i.secret ? 'password' : 'text', autocomplete: 'off', placeholder: i.hint || (i.optional ? 'Optional' : 'Required') }) };
  });
  const el = h('div', { class: 'card form' },
    h('div', {}, h('label', { class: 'lbl', htmlFor: nid }, 'Name in Nexus'), name),
    h('div', {}, h('label', { class: 'lbl', htmlFor: cid }, s.config.url ? 'Connects to (JSON, edit if needed)' : 'Runs this on your machine (JSON, edit if needed)'), conf),
    asks.map(({ i, id, el: input }) => h('div', {}, h('label', { class: 'lbl', htmlFor: id }, i.label), input)));
  const value = () => {
    let config;
    try { config = JSON.parse(conf.value); } catch { throw new Error(`The settings for ${name.value} are not valid JSON.`); }
    for (const { i, el: input } of asks) {
      const v = input.value.trim();
      if (!v) { if (i.optional) continue; throw new Error(`${i.label} is required.`); }
      if (i.env) config.env = { ...config.env, [i.env]: v };
      if (i.header) config.headers = { ...config.headers, [i.header]: `${i.prefix || ''}${v}` };
    }
    return { name: name.value.trim(), config };
  };
  return { el, value };
}

function marketDetail(it, kind, back) {
  const err = h('div', { class: 'err', role: 'alert' });
  const meta = [it.author && `by ${it.author}`, it.category, it.stats].filter(Boolean).join(' · ');
  const parts = [
    backBtn(back),
    h('div', { class: 'dtitle' }, h('span', { class: 'ticon big', 'aria-hidden': 'true' }, it.icon || (it.name[0] || '?').toUpperCase()),
      h('div', { class: 'grow' }, h('h3', {}, it.name), meta && h('div', { class: 'small muted' }, meta))),
    it.description && h('p', {}, it.description),
    h('div', { class: 'mlinks small' }, (it.links || (it.url ? [['Website', it.url]] : [])).map(([label, url]) => extLink(label, url))),
    it.notes && h('p', { class: 'small note' }, it.notes),
    it.credit && h('p', { class: 'small muted' }, it.credit),
  ];
  const busy = async (btn, fn) => {
    err.textContent = ''; btn.disabled = true;
    try { await fn(); } catch (e) { err.textContent = e.message; } finally { btn.disabled = false; }
  };
  if (kind === 'mcp') {
    if (!it.server) return [...parts, h('p', { class: 'small muted' }, 'This listing has no install command Nexus could read. Open it, then add the server under mcpServers in Settings.')];
    const form = serverForm(it.server);
    return [...parts, form.el,
      h('p', { class: 'small muted' }, it.server.config.url ? 'Tool calls go to this address over the network.' : 'Installing runs third-party code on this machine, even in bypass mode. Check the source first.'), err,
      h('div', { class: 'acts' }, h('button', { class: 'btn primary', type: 'button', onclick: e => busy(e.currentTarget, async () => {
        const { name, config } = form.value();
        await api('POST', '/api/mcp-servers', { name, config });
        toast(`Added ${name}. Its tools arrive with your next message.`);
        back();
      }) }, 'Install'))];
  }
  if (it.external) {
    return [...parts, h('p', { class: 'small muted' }, "This is a product listed on aiagentslist.com, not an agent file Nexus can install. The AI can write a Nexus agent that does the same job."),
      h('div', { class: 'acts' }, h('button', { class: 'btn primary', type: 'button', onclick: () => { createWithAI(`that works like ${it.name}: ${it.description}`); } }, icon('spark'), 'Create a Nexus agent like this'))];
  }
  const project = projectForInstall();
  if (!project) return [...parts, h('p', { class: 'err' }, 'Create a project first.')];
  const sid = uid();
  const scope = h('select', { class: 'field', id: sid }, h('option', { value: 'project' }, `This project (${pretty(project)})`), h('option', { value: 'user' }, 'All projects'));
  const forms = (it.servers || []).map(serverForm);
  const install = (use, btn) => busy(btn, async () => {
    const servers = forms.map(f => f.value());
    const { name, description, tools, model, prompt } = it.agent;
    if (S.project === project && S.meta.agents.some(a => a.name === name && !a.builtin) && !await confirmBox(`Replace ${name}?`, 'An agent type with this name already exists here.', 'Replace', 'danger')) return;
    await api('POST', `${P(project)}/agent-defs`, { scope: scope.value, name, description, tools: tools || [], model, prompt });
    for (const s of servers) await api('POST', '/api/mcp-servers', s);
    if (S.project === project) await loadMeta();
    if (use && S.project === project && S.state) setOption('agent', name);
    toast(use ? `Installed ${name}. This chat now works as it.` : `Installed ${name}.`);
    back();
  });
  return [...parts,
    h('div', { class: 'small muted' }, `Tools: ${it.agent.tools?.join(', ') || 'every tool'}`),
    h('details', { class: 'fold' }, h('summary', {}, 'Read its instructions', icon('down')), h('div', { class: 'out' }, it.agent.prompt)),
    forms.length ? [h('p', { class: 'small' }, `It also adds ${forms.length} MCP server${forms.length > 1 ? 's' : ''}:`), forms.map(f => f.el)] : null,
    h('div', {}, h('label', { class: 'lbl', htmlFor: sid }, 'Install for'), scope), err,
    h('div', { class: 'acts' },
      h('button', { class: 'btn', type: 'button', onclick: e => install(false, e.currentTarget) }, 'Install'),
      S.project === project && S.state && h('button', { class: 'btn primary', type: 'button', onclick: e => install(true, e.currentTarget) }, 'Install and use in this chat'))];
}

const exportChat = guard(async name => {
  if (!name) return;
  const { markdown } = await api('GET', `${P(name)}/export`);
  const a = h('a', { href: URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' })), download: `${name}.md` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Downloaded ${name}.md`);
});

// ---- files ----
let pendingOpen = null, current = null;
function filesView(view) {
  current = null;
  const tree = h('div', { class: 'tree', 'aria-label': 'Project files' });
  const pathEl = h('span', { class: 'path muted' }, 'Select a file');
  const area = h('textarea', { spellcheck: false, disabled: true, 'aria-label': 'File contents', wrap: 'off', oninput: () => { saveBtn.disabled = false; },
    onkeydown: e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end'); saveBtn.disabled = false; }
    } });
  const saveBtn = h('button', { class: 'btn small primary', disabled: true, onclick: () => save() }, 'Save');
  const save = guard(async () => {
    if (!current) return;
    await api('PUT', `${P(S.project)}/file`, { path: current, content: area.value });
    saveBtn.disabled = true;
    toast('Saved.');
  });
  const newBtn = h('button', { class: 'btn small', onclick: () => newFile(open) }, 'New file');
  // Hands the open file, and the selected lines if any, to the chat as an @ mention.
  const askBtn = h('button', { class: 'btn small', disabled: true, title: 'Ask about this file, or about the selected lines', onclick: () => {
    const line = i => area.value.slice(0, i).split('\n').length;
    const [a, b] = [line(area.selectionStart), line(Math.max(area.selectionStart, area.selectionEnd - 1))];
    const ref = `@${current}${area.selectionEnd > area.selectionStart ? (a === b ? ` line ${a}` : ` lines ${a}-${b}`) : ''} `;
    drafts[S.project] = `${(drafts[S.project] || '').trimEnd()} ${ref}`.trimStart();
    go(S.project, null, 'chat');
    $input.focus();
    $input.setSelectionRange($input.value.length, $input.value.length);
  } }, 'Ask Nexus');
  const open = guard(async rel => {
    if (!saveBtn.disabled && !await confirmBox('Discard unsaved changes?', `${current} has changes that aren't saved.`, 'Discard', 'danger')) return;
    try {
      const { content } = await api('GET', `${P(S.project)}/file?path=${encodeURIComponent(rel)}`);
      area.value = content;
      area.disabled = false;
    } catch (e) {
      // A missing file opens empty, ready to be created on save.
      if (!/no such file/i.test(e.message)) throw e;
      area.value = ''; area.disabled = false;
    }
    current = rel; pathEl.textContent = rel; pathEl.classList.remove('muted'); saveBtn.disabled = true; askBtn.disabled = false;
    tree.querySelectorAll('.on').forEach(b => b.classList.remove('on'));
    tree.querySelector(`[data-path="${CSS.escape(rel)}"]`)?.classList.add('on');
  });
  async function list(rel, into) {
    const items = await api('GET', `${P(S.project)}/tree?path=${encodeURIComponent(rel)}`);
    if (rel === '.' && !items.length) { into.replaceChildren(h('li', { class: 'muted', style: 'padding:4px 6px' }, 'Empty folder')); return; }
    into.replaceChildren(...items.map(it => {
      const full = rel === '.' ? it.name : `${rel}/${it.name}`;
      const sub = h('ul', { hidden: true });
      const btn = h('button', { class: it.dir ? 'd' : '', onclick: guard(async () => {
        if (!it.dir) return open(full);
        sub.hidden = !sub.hidden;
        btn.setAttribute('aria-expanded', String(!sub.hidden));
        if (!sub.hidden && !sub.children.length) await list(full, sub);
      }) }, it.dir ? `${it.name}/` : it.name);
      btn.dataset.path = full;
      return h('li', {}, btn, it.dir ? sub : null);
    }));
  }
  const root = h('ul');
  tree.append(root);
  view.append(h('div', { class: 'files' }, tree, h('div', { class: 'editor' }, h('div', { class: 'ebar' }, pathEl, askBtn, newBtn, saveBtn), area)));
  guard(list)('.', root);
  if (pendingOpen) { open(pendingOpen); pendingOpen = null; }
}
function newFile(open) {
  const input = h('input', { class: 'field mono', id: 'nf', placeholder: 'src/index.js', spellcheck: false, autocapitalize: 'off' });
  dialog({ title: 'New file', body: h('div', {}, h('label', { class: 'lbl', htmlFor: 'nf' }, 'Path in this project'), input),
    actions: [{ label: 'Cancel' }, { label: 'Open', class: 'primary', run: () => { if (input.value.trim()) open(input.value.trim()); } }] });
}

// ---- changes ----
function changesView(view) {
  const box = h('pre', { class: 'diff', tabIndex: 0, 'aria-label': 'Changes' }, 'Loading…');
  const since = h('span', { class: 'path muted' });
  view.append(h('div', { class: 'ebar' }, since, h('button', { class: 'btn small', onclick: load }, 'Refresh')), box);
  async function load() {
    try {
      const { since: s, diff } = await api('GET', `${P(S.project)}/changes`);
      since.textContent = s ? `Since your last prompt: ${s}` : 'No checkpoint yet. Send a prompt first.';
      box.replaceChildren(...(diff ? diff.split('\n').map(l => {
        const file = /^diff --git a\/.+ b\/(.+)$/.exec(l)?.[1];
        if (file) return h('span', { class: 'head' }, l, h('button', { class: 'btn small undo', type: 'button', onclick: guard(async () => {
          if (!await confirmBox(`Undo ${file}?`, 'It goes back to how it was before your last prompt. A checkpoint is saved first, so Rewind can bring the change back.', 'Undo file', 'danger')) return;
          await api('POST', `${P(S.project)}/changes/undo`, { path: file });
          load();
        }) }, 'Undo file'));
        const cls = /^(\+\+\+|---|diff )/.test(l) ? 'head' : l.startsWith('@@') ? 'hunk' : l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : '';
        return cls ? h('span', { class: cls }, l) : `${l}\n`;
      }) : ['No file changes.']));
    } catch (e) { box.textContent = e.message; }
  }
  load();
}

// ---- terminal ----
let termState = null;
function teardownTerm() {
  if (!termState) return;
  termState.ws.close(); termState.term.dispose(); removeEventListener('resize', termState.fit);
  termState = null;
}
// The iOS keyboard has no Esc, Tab, Ctrl or arrows. Ctrl applies to the next key typed.
const TERM_KEYS = [['Esc', '\x1b'], ['Tab', '\t'], ['Ctrl'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C']];
const termKeys = () => h('div', { class: 'tkeys' }, TERM_KEYS.map(([label, seq]) => h('button', { class: 'btn small', type: 'button', onmousedown: e => e.preventDefault(),
  onclick: e => { if (!seq) e.currentTarget.classList.toggle('on'); else if (termState?.ws.readyState === 1) termState.ws.send(JSON.stringify({ i: seq })); } }, label)));
function termView(view) {
  const box = h('div', { id: 'term' });
  view.append(h('div', { class: 'termwrap' }, box, termKeys()));
  // iOS drops the socket when the app is backgrounded, so a dead shell gets replaced.
  if (termState?.project !== S.project || termState?.ws.readyState > 1) teardownTerm();
  if (termState) {
    box.replaceWith(termState.el);
    requestAnimationFrame(() => { termState.fit(); termState.term.focus(); });
    return;
  }
  const term = new Terminal({ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, cursorBlink: true, scrollback: 10000, theme: { background: '#000000' } });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(box);
  fitAddon.fit();
  const project = S.project;
  let announced = false;
  const openWs = () => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/term?project=${encodeURIComponent(project)}&cols=${term.cols}&rows=${term.rows}`);
    ws.onopen = () => { announced = false; };
    ws.onmessage = e => term.write(e.data);
    ws.onclose = e => {
      if (termState?.ws !== ws) return;
      // 1000 and 1005 mean the shell exited or this page closed it; anything else is a lost connection.
      if (e.code === 1000 || e.code === 1005) { term.write('\r\n\x1b[90m[session closed: switch tabs for a new shell]\x1b[0m\r\n'); return; }
      if (!announced) term.write('\r\n\x1b[90m[connection lost: starting a new shell when it returns]\x1b[0m\r\n');
      announced = true;
      setTimeout(() => { if (termState?.ws === ws) termState.ws = openWs(); }, 2000);
    };
    return ws;
  };
  const ws = openWs();
  term.onData(d => {
    const ctrl = document.querySelector('.tkeys .on');
    if (ctrl && d.length === 1) { ctrl.classList.remove('on'); d = String.fromCharCode(d.toUpperCase().charCodeAt(0) & 31); }
    if (termState?.ws.readyState === 1) termState.ws.send(JSON.stringify({ i: d }));
  });
  term.onResize(({ cols, rows }) => { if (termState?.ws.readyState === 1) termState.ws.send(JSON.stringify({ cols, rows })); });
  const fit = () => { if (box.isConnected) fitAddon.fit(); };
  addEventListener('resize', fit);
  termState = { project: S.project, term, ws, fit, el: box };
  term.focus();
}

// ---- agents ----
let refreshAgentsTimer, agentsBox;
const refreshAgentsSoon = () => { clearTimeout(refreshAgentsTimer); refreshAgentsTimer = setTimeout(guard(fillAgents), 300); };
const statusDot = st => st === 'running' ? 'running' : st === 'completed' || /^exited 0/.test(st) ? 'done' : 'error';

function agentsPage(hamb) {
  agentsBox = h('div', { class: 'page' });
  $main.replaceChildren(h('header', { class: 'top' }, hamb, h('h1', {}, 'Agents')), h('div', { class: 'view' }, agentsBox));
  guard(fillAgents)();
}

async function fillAgents() {
  if (!agentsBox?.isConnected) return;
  const { agents, shells, schedules } = await api('GET', '/api/agents');
  const project = S.project || S.projects[0]?.name;
  const meta = project ? await api('GET', `${P(project)}/meta`) : { agents: [], skills: [] };
  // Don't wipe a form someone is typing in when an agent event arrives.
  if (agentsBox.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return refreshAgentsSoon();
  agentsBox.replaceChildren(...[
    h('h2', {}, 'Launch an agent'), launchForm(meta.agents, project),
    h('h2', {}, `Agent runs (${agents.length})`),
    agents.length ? agents.slice(0, 100).map(a => h('div', { class: 'card rowline' },
      h('span', { class: `dot ${statusDot(a.status)}`, title: a.status }),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, a.description),
        h('div', { class: 'small muted' }, `${a.type} · ${pretty(a.project)}${a.branch ? ` · ${a.branch}` : ''} · ${a.status} · ${ago(a.started)} · ${fmt(a.tokens || 0)} tokens`)),
      h('button', { class: 'btn small', onclick: () => agentDetail(a.id) }, 'View'),
      a.status === 'running' && h('button', { class: 'btn small danger', onclick: guard(() => api('POST', `/api/agents/${a.id}/stop`)) }, 'Stop'))) : h('p', { class: 'muted' }, 'No agents have run yet.'),
    h('h2', {}, `Schedules (${schedules.length})`),
    schedules.length ? schedules.map(x => h('div', { class: 'card rowline' },
      h('div', { class: 'grow' }, h('div', { class: 'mono' }, x.cron), h('div', { class: 'small muted' }, `${pretty(x.project)} · ${x.prompt}`)),
      h('button', { class: 'btn small danger', 'aria-label': `Remove schedule ${x.cron}`, onclick: guard(() => api('DELETE', `/api/schedules/${encodeURIComponent(x.id)}`).then(refreshAgentsSoon)) }, 'Remove')))
      : h('p', { class: 'muted' }, 'Nothing scheduled. In a chat, /schedule 0 9 * * 1-5 /review reviews that project every weekday at 9.'),
    h('h2', {}, `Background shells (${shells.length})`),
    shells.length ? shells.map(s => h('div', { class: 'card rowline' },
      h('span', { class: `dot ${statusDot(s.status)}`, title: s.status }),
      h('div', { class: 'grow' }, h('div', { class: 'mono' }, s.command), h('div', { class: 'small muted' }, `${pretty(s.project)} · ${s.status} · ${ago(s.started)}`)),
      h('button', { class: 'btn small', onclick: () => shellDetail(s.id) }, 'Output'),
      s.status === 'running' && h('button', { class: 'btn small danger', onclick: guard(() => api('POST', `/api/shells/${s.id}/kill`).then(refreshAgentsSoon)) }, 'Kill'))) : h('p', { class: 'muted' }, 'No background shells.'),
    h('div', { class: 'rowline', style: 'margin:22px auto 10px' }, h('h2', { style: 'margin:0', class: 'grow' }, `Agent types${project ? ` for ${project}` : ''}`),
      project && h('button', { class: 'btn small', onclick: () => editDef(project, null) }, icon('plus'), 'New type'),
      project && h('button', { class: 'btn small', onclick: () => createWithAI() }, icon('spark'), 'Create with AI'),
      h('button', { class: 'btn small primary', onclick: () => openMarket('agents') }, icon('grid'), 'Marketplace')),
    meta.agents.map(d => h('div', { class: 'card rowline' },
      h('div', { class: 'grow' }, h('div', { class: 'title mono' }, d.name), h('div', { class: 'small muted' }, d.description),
        h('div', { class: 'small muted' }, `${d.builtin ? 'Built in' : d.scope} · tools: ${d.tools?.join(', ') || 'all'}${d.model ? ` · ${d.model}` : ''}`)),
      !d.builtin && h('button', { class: 'btn small', onclick: () => editDef(project, d) }, 'Edit'),
      !d.builtin && h('button', { class: 'btn small danger', 'aria-label': `Delete ${d.name}`, onclick: guard(async () => {
        if (await confirmBox(`Delete ${d.name}?`, 'This removes the agent type from Nexus folders. Types in other folders stay.', 'Delete', 'danger')) { await api('DELETE', `${P(project)}/agent-defs/${encodeURIComponent(d.name)}`); refreshAgentsSoon(); }
      }) }, 'Delete'))),
    meta.skills.length ? [h('h2', {}, `Skills (${meta.skills.length})`), meta.skills.map(k => h('div', { class: 'card' }, h('div', { class: 'title mono' }, k.name), h('div', { class: 'small muted' }, k.description)))] : null,
  ].flat(Infinity).filter(Boolean));
}

function launchForm(defs, project) {
  if (!project) return h('p', { class: 'muted' }, 'Create a project first.');
  const proj = h('select', { class: 'field', id: 'lp' }, S.projects.map(p => h('option', { value: p.name, selected: p.name === project }, pretty(p.name))));
  const type = h('select', { class: 'field', id: 'lt' }, defs.map(d => h('option', { value: d.name }, d.name)));
  const desc = h('input', { class: 'field', id: 'ld', placeholder: 'Audit dependencies' });
  const prompt = h('textarea', { class: 'field', id: 'lq', placeholder: 'A complete, self-contained task' });
  const isolate = h('input', { type: 'checkbox', id: 'li' });
  return h('form', { class: 'card form', onsubmit: guard(async e => {
    e.preventDefault();
    await api('POST', '/api/agents', { project: proj.value, type: type.value, description: desc.value || 'Manual agent', prompt: prompt.value, isolation: isolate.checked ? 'worktree' : undefined });
    prompt.value = ''; desc.value = ''; document.activeElement.blur();
    refreshAgentsSoon();
  }) },
  h('div', { class: 'two' }, h('div', {}, h('label', { class: 'lbl', htmlFor: 'lp' }, 'Project'), proj), h('div', {}, h('label', { class: 'lbl', htmlFor: 'lt' }, 'Type'), type)),
  h('div', {}, h('label', { class: 'lbl', htmlFor: 'ld' }, 'Description'), desc),
  h('div', {}, h('label', { class: 'lbl', htmlFor: 'lq' }, 'Task'), prompt),
  h('label', { class: 'rowline check', htmlFor: 'li' }, isolate, h('span', { class: 'grow' }, 'Own branch: work in a separate git worktree, so agents can edit at the same time. The changes come back as a branch to merge.')),
  h('div', {}, h('button', { class: 'btn primary', disabled: false }, 'Launch')),
  h('p', { class: 'small muted', style: 'margin:0' }, 'It runs in the background. Permission prompts appear in that project’s chat.'));
}

const agentDetail = guard(async id => {
  const a = await api('GET', `/api/agents/${id}`);
  const log = (a.log || []).map(e => e.type === 'tool'
    ? h('details', { class: 'fold tool' }, h('summary', {}, h('span', { class: `dot ${e.status}` }), h('span', { class: 'tname' }, e.name), h('span', { class: 'targ muted' }, String(toolTarget(e.name, e.args || {})).split('\n')[0])), h('div', { class: 'out' }, e.output || ''))
    : h('div', { class: 'out' }, e.text || ''));
  dialog({ title: a.description, wide: true, body: h('div', { style: 'overflow:auto;max-height:65vh' },
    h('p', { class: 'small muted' }, `${a.type} · ${a.status} · ${a.model}`),
    h('div', { class: 'out' }, a.prompt), log,
    a.result ? [h('h3', { style: 'font-size:14px;margin:10px 0 4px' }, 'Result'), h('div', { class: 'out' }, a.result)] : null),
  actions: [{ label: 'Close' }] });
});
const shellDetail = guard(async id => {
  const s = await api('GET', `/api/shells/${id}`);
  dialog({ title: `Shell: ${s.status}`, wide: true, body: h('div', { class: 'out', style: 'max-height:65vh' }, s.output || '(no output)'), actions: [{ label: 'Close' }] });
});

function editDef(project, d) {
  const name = h('input', { class: 'field mono', id: 'dn', value: d?.name || '', disabled: Boolean(d), spellcheck: false, autocapitalize: 'off' });
  const description = h('input', { class: 'field', id: 'dd', value: d?.description || '' });
  const tools = h('input', { class: 'field mono', id: 'dt', value: d?.tools?.join(', ') || '', placeholder: 'All tools' });
  const model = h('input', { class: 'field mono', id: 'dm', value: d?.model || '', placeholder: 'Same as the conversation' });
  const scope = h('select', { class: 'field', id: 'ds' }, h('option', { value: 'project', selected: d?.scope === 'project' }, `This project (${pretty(project)})`), h('option', { value: 'user', selected: d?.scope === 'user' }, 'All projects'));
  const prompt = h('textarea', { class: 'field', id: 'dp', value: d?.prompt || '' });
  const err = h('div', { class: 'err', role: 'alert' });
  const row = (id, label, input) => h('div', {}, h('label', { class: 'lbl', htmlFor: id }, label), input);
  dialog({ title: d ? `Edit ${d.name}` : 'New agent type', wide: true,
    body: h('div', { class: 'form' }, h('div', { class: 'two' }, row('dn', 'Name', name), row('ds', 'Available in', scope)), row('dd', 'When to use it', description),
      h('div', { class: 'two' }, row('dt', 'Tools, comma separated', tools), row('dm', 'Model', model)), row('dp', 'Instructions', prompt), err),
    actions: [{ label: 'Cancel' }, { label: 'Save', class: 'primary', run: async () => {
      try {
        await api('POST', `${P(project)}/agent-defs`, { name: name.value.trim(), description: description.value, tools: tools.value.split(',').map(t => t.trim()).filter(Boolean), model: model.value.trim(), prompt: prompt.value, scope: scope.value });
        refreshAgentsSoon();
      } catch (e) { err.textContent = e.message; return false; }
    } }] });
}

// ---- settings ----
async function settingsPage(hamb) {
  const page = h('div', { class: 'page' });
  $main.replaceChildren(h('header', { class: 'top' }, hamb, h('h1', {}, 'Settings')), h('div', { class: 'view' }, page));
  const { text, mcp } = await guard(() => api('GET', '/api/settings'))() || { text: '', mcp: [] };
  const area = h('textarea', { class: 'field settings-text', spellcheck: false, value: text, id: 'set', wrap: 'off' });
  const err = h('div', { class: 'err', role: 'alert' });
  const remove = name => guard(async () => {
    if (!await confirmBox(`Remove ${name}?`, 'Its tools disappear from new messages. You can add it again from the marketplace.', 'Remove', 'danger')) return;
    await api('DELETE', `/api/mcp-servers/${encodeURIComponent(name)}`);
    render();
  });
  page.append(...[
    selfBot(),
    await versionCard(),
    h('div', { class: 'rowline', style: 'margin:22px auto 10px' }, h('h2', { style: 'margin:0', class: 'grow' }, 'MCP servers'),
      h('button', { class: 'btn small primary', type: 'button', onclick: () => openMarket('mcp') }, icon('grid'), 'Add MCP server')),
    mcp.length ? mcp.map(s => h('div', { class: 'card rowline' }, h('span', { class: `dot ${s.status === 'connected' ? 'done' : s.status === 'error' ? 'error' : 'awaiting'}` }),
      h('div', { class: 'grow' }, h('div', { class: 'title mono' }, s.name), h('div', { class: 'small muted' }, s.error || `${s.remote ? 'remote · ' : ''}${s.status} · ${s.tools.length} tools`)),
      h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Remove ${s.name}`, onclick: remove(s.name) }, 'Remove'))) : h('p', { class: 'muted' }, 'None yet. Add Hugging Face, Playwright, Context7, GitHub or hundreds more from the marketplace.'),
    h('p', { class: 'small muted mlinks' }, 'Browse online: ', extLink('aiagentslist.com', 'https://aiagentslist.com/mcp-servers'), ' · ', extLink('Hugging Face Spaces', 'https://huggingface.co/spaces?filter=mcp-server'), ' · ', extLink('MCP on GitHub', 'https://github.com/modelcontextprotocol/servers')),
    await globalPromptsCard(),
    notifyCard(),
    h('h2', {}, h('label', { htmlFor: 'set' }, '~/.nexus/settings.json')),
    h('p', { class: 'small muted' }, 'Hooks run on PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStop, PreCompact and Notification; a hook exiting with 2 blocks a tool call or prompt. MCP servers reconnect within seconds of saving.'),
    h('p', { class: 'small muted' }, 'Models: Ollama and LM Studio appear in the model picker while they run on this computer. Set OPENROUTER_API_KEY (hundreds of models, some free), GEMINI_API_KEY, GROQ_API_KEY, DEEPSEEK_API_KEY, MISTRAL_API_KEY or XAI_API_KEY in Nexus\'s environment, or add any OpenAI-compatible server under "providers", as in the example.'),
    area, err,
    h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn primary', onclick: async () => {
      err.textContent = '';
      try { await api('PUT', '/api/settings', { text: area.value }); toast('Saved.'); } catch (e) { err.textContent = e.message; }
    } }, 'Save')),
    h('h2', {}, 'Example'),
    h('pre', { class: 'out' }, JSON.stringify({ autoCompactTokens: 300000, providers: { openrouter: { apiKey: 'sk-or-…' }, groq: { name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: 'gsk_…' } }, hooks: { PreToolUse: [{ matcher: 'Bash', command: 'jq -r .input.command >> ~/.nexus/bash.log' }] }, mcpServers: { memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] } } }, null, 2)),
  ].flat());
}

function notifyCard() {
  const supported = 'Notification' in window;
  const box = h('input', { type: 'checkbox', id: 'notify', disabled: !supported, checked: supported && pref('nexus.notify') === '1' && Notification.permission === 'granted', onchange: async () => {
    if (box.checked && Notification.permission !== 'granted') box.checked = (await Notification.requestPermission()) === 'granted';
    pref('nexus.notify', box.checked ? '1' : '0');
    if (canPush) setPush(box.checked).catch(err => toast(`Push notifications didn't turn ${box.checked ? 'on' : 'off'}: ${err.message}`));
    if (box.checked) new Notification('Nexus', { body: 'Notifications are on.', icon: '/icon-180.png' });
  } });
  return [h('h2', {}, 'Notifications'),
    h('label', { class: 'card rowline check', htmlFor: 'notify' }, box, h('span', { class: 'grow' }, canPush ? 'Notify me when a chat finishes or needs me, even with Nexus closed' : 'Tell me when a chat finishes while Nexus is in the background'),
      !supported && h('span', { class: 'small muted' }, 'Not supported in this browser. Add Nexus to your home screen on iPhone.'))];
}

function selfBot() {
  const area = h('textarea', { class: 'field', id: 'self', placeholder: 'What should Nexus add or change?' });
  const err = h('div', { class: 'err', role: 'alert' });
  return h('form', { onsubmit: async e => {
    e.preventDefault();
    err.textContent = '';
    try {
      const { name } = await api('POST', '/api/self-improve', { text: area.value });
      await refreshProjects();
      go(name);
    } catch (e2) { err.textContent = e2.message; }
  } },
  h('h2', {}, h('label', { htmlFor: 'self' }, 'Self-improvement bot')),
  h('p', { class: 'small muted' }, 'It edits this server’s code without asking, runs the tests, then restarts Nexus. If the server doesn’t come back, the change is reverted. A restart interrupts any turn running in other chats.'),
  area, err,
  h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn primary' }, 'Start')));
}

async function versionCard() {
  const line = h('div', { class: 'title mono' });
  const note = h('div', { class: 'small muted' });
  const show = async () => {
    const v = await api('GET', '/api/version').catch(() => null);
    if (!v) { note.textContent = 'Version unavailable.'; return; }
    line.textContent = `v${v.version} · ${v.commit}`;
    note.textContent = [`${v.local} local change${v.local === 1 ? '' : 's'}`, v.behind ? `${v.behind} behind` : 'none behind', v.auto ? 'Auto-updates on' : 'Auto-updates off', v.status].filter(Boolean).join(' · ');
  };
  await show();
  return [h('h2', {}, 'Version'), h('div', { class: 'card rowline' }, h('div', { class: 'grow' }, line, note),
    h('button', { class: 'btn', type: 'button', onclick: async () => {
      try { await api('POST', '/api/update', {}); toast('Checking for updates.'); setTimeout(show, 8000); } catch (e) { toast(e.message); }
    } }, 'Update now'))];
}

// ---- keys and boot ----
addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.state?.running && !S.page && S.tab === 'chat' && !document.querySelector('dialog[open], .menu')) sendWs({ t: 'interrupt' });
});

async function boot() {
  // Re-sending the subscription each visit keeps the server's copy current if the browser rotated it.
  if (canPush && pref('nexus.notify') === '1' && window.Notification?.permission === 'granted') setPush(true).catch(() => {});
  S.me = await api('GET', '/api/me');
  shell();
  await refreshProjects();
  connect();
  const m = /^#\/(?:p\/([^/]+)\/(\w+)|(agents|settings|marketplace))?/.exec(location.hash) || [];
  const name = m[1] ? decodeURIComponent(m[1]) : null;
  if (m[3]) go(null, m[3]);
  else if (name && S.projects.some(p => p.name === name)) go(name, null, ['chat', 'files', 'changes', 'terminal'].includes(m[2]) ? m[2] : 'chat');
  else if (S.projects[0]) go(S.projects[0].name);
  else go(null);
  api('GET', '/api/models').then(list => { S.models = list; syncComposer(); }).catch(() => {});
}

// Let CSS fill the screen normally; only constrain it to the visual viewport for a keyboard.
// Keeping a pixel height after the keyboard closes can leave a large empty area below the composer.
// innerHeight can shrink along with the keyboard, so measure against the tallest height seen at this width.
const vv = window.visualViewport;
let tallest = 0, seenWidth;
function viewport() {
  if (vv?.scale > 1.01) return;
  const root = document.documentElement;
  const editing = document.activeElement?.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
  if (innerWidth !== seenWidth) { seenWidth = innerWidth; tallest = 0; }
  tallest = Math.max(tallest, innerHeight, vv?.height || 0);
  const opened = !!(vv && editing && tallest - vv.height > 120);
  const was = root.classList.contains('kb');
  if (opened) {
    root.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
    root.style.setProperty('--app-top', `${Math.round(vv.offsetTop)}px`);
  } else {
    root.style.removeProperty('--app-h');
    root.style.removeProperty('--app-top');
  }
  root.classList.toggle('kb', opened);
  root.classList.toggle('short', opened && vv.height < 420);
  if (!opened) scrollTo(0, 0);
  termState?.fit();
  if (opened && !was && $log?.isConnected) $log.scrollTop = $log.scrollHeight;
}
if (vv) { vv.addEventListener('resize', viewport); vv.addEventListener('scroll', viewport); }
addEventListener('resize', viewport);
addEventListener('pageshow', viewport);
document.addEventListener('focusout', () => requestAnimationFrame(viewport));
document.addEventListener('visibilitychange', () => { if (!document.hidden) viewport(); });
viewport();

marked.use({ gfm: true, breaks: false });
// Only a real 401 means signed out; anything else is the server being away.
const start = () => fetch('/api/me')
  .then(r => { if (r.status === 401) return showLogin(); if (!r.ok) throw new Error(r.status); return boot(); })
  .catch(() => { connLost(); setTimeout(start, 3000); });
start();
