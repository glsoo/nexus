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
  term: '<path d="M5 7l5 5-5 5M12 18h7"/>', fork: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v1a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V7M12 12v5"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>', bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>', bot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M9 14h.01M15 14h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', pen: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', clip: '<path d="M21 11l-9 9a5.5 5.5 0 0 1-8-8l9-9a3.7 3.7 0 0 1 5 5l-9 9a1.8 1.8 0 0 1-3-3l8-8"/>',
  undo: '<path d="M3 7v6h6M3 13a9 9 0 1 0 3-7L3 9"/>', down: '<path d="M6 9l6 6 6-6"/>', check: '<path d="M5 13l4 4L19 7"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>', spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>', back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M6 6l12 12M6 18L18 6"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.3c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
};
const icon = name => { const t = document.createElement('template'); t.innerHTML = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`; return t.content.firstChild; };

async function api(method, url, data) {
  const res = await fetch(url, { method, headers: data ? { 'content-type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && !json.provider && url !== '/api/login') { showLogin(); throw new Error('Signed out.'); }
  if (!res.ok) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), json.provider ? { provider: json.provider } : {});
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

// action: [label, run], a button in the toast.
function toast(text, action, ms = 5000) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, text,
    action && h('button', { class: 'btn small', type: 'button', onclick: () => { el.remove(); action[1](); } }, action[0]));
  document.body.append(el);
  setTimeout(() => exit(el, { opacity: 0, transform: 'translate(-50%, 12px)' }, 220).then(() => el.remove()), ms);
}
const guard = fn => async (...a) => {
  try { return await fn(...a); } catch (e) {
    if (!e.provider) return toast(e.message);
    return dialog({ title: `${e.provider} request failed`, wide: true, body: h('div', { class: 'out err', role: 'alert' }, e.message),
      actions: [{ label: 'Copy', run: async () => { await copyText(e.message); toast('Copied.'); return false; } }, { label: 'Close', class: 'primary' }] });
  }
};

function markdown(el, text, final = true) {
  el.innerHTML = DOMPurify.sanitize(marked.parse(text || ''));
  if (final) el.querySelectorAll('pre code').forEach(c => { hljs.highlightElement(c); c.parentElement.append(copyButton(() => c.textContent)); });
  el.querySelectorAll('a').forEach(a => {
    if (final && /^\/present\/[\w-]{16}\//.test(a.pathname) && /[?&]download\b/.test(a.search)) a.replaceWith(fileCard(a));
    else { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  });
}

const bytes = n => { const i = n ? Math.min(Math.floor(Math.log(n) / Math.log(1024)), 3) : 0; return `${i ? (n / 1024 ** i).toFixed(1) : n} ${['B', 'KB', 'MB', 'GB'][i]}`; };
// A temporary download link (scripts/present.js) becomes a card. A HEAD request gives the file's real name and size, and shows when the link has ended.
function fileCard(a) {
  const href = a.pathname + a.search; // This server's own path, whichever address the link was written with.
  const name = h('div', { class: 'fc-name' }, a.textContent.replace(/^download\s+/i, ''));
  const meta = h('div', { class: 'small muted' }, 'Temporary link');
  const save = h('a', { class: 'btn primary', href, download: '' }, icon('download'), 'Download');
  fetch(href, { method: 'HEAD' }).then(r => {
    if (!r.ok) { meta.textContent = 'This link has ended'; save.remove(); return; }
    const file = /filename\*=UTF-8''([^;]+)/.exec(r.headers.get('content-disposition') || '');
    if (file) name.textContent = decodeURIComponent(file[1]);
    const size = r.headers.get('content-length');
    if (size) meta.textContent = `${bytes(Number(size))} · Temporary link`;
  }).catch(() => {});
  return h('div', { class: 'filecard' }, h('span', { class: 'fc-icon' }, icon('file')), h('div', { class: 'fc-text' }, name, meta), save);
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

// ref(shut): for a dialog that closes itself, such as one waiting on something else.
function dialog({ title, body, wide, actions, ref }) {
  return new Promise(resolve => {
    const shut = value => {
      resolve(value);
      d.classList.add('closing');
      exit(d, { opacity: 0, transform: 'scale(.97)' }).then(() => d.close());
    };
    ref?.(shut);
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
const S = { project: null, tab: 'chat', page: null, state: null, ws: null, projects: [], models: [], meta: { commands: [], skills: [], agents: [] }, prompts: null, me: null, images: [], alerts: {} };
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
  $side = h('aside', { class: 'side', id: 'workspace-sidebar', 'aria-label': 'Workspace', onkeydown: e => { if (e.key === 'Escape') drawer(false); } },
    h('div', { class: 'side-head' }, h('img', { src: '/icon.svg?v=purple', alt: '' }), 'Nexus',
      h('button', { class: 'icon-btn side-close', type: 'button', 'aria-label': 'Close menu', onclick: () => drawer(false) }, icon('close'))),
    h('div', { class: 'newrow' }, h('button', { class: 'btn new', onclick: guard(newProject) }, icon('plus'), 'New project'),
      h('button', { class: 'btn', 'aria-label': 'Open a folder', title: 'Open a folder', onclick: () => chooseFolder() }, icon('folder')),
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
const drawer = open => {
  const wasOpen = $side.classList.contains('open');
  $side.classList.toggle('open', open); $scrim.classList.toggle('open', open);
  const trigger = $main.querySelector('.hamb');
  trigger?.setAttribute('aria-expanded', String(open));
  if (open) $side.querySelector('.side-close').focus();
  else if (wasOpen) trigger?.focus();
};

// The folder keeps its dashes; only what people read changes. "say-hello" shows as "Say Hello".
// A project's other chats are "<project>~<id>", shown as "Project · Title".
const chatTitle = key => S.projects.find(p => p.name === key)?.title || 'New chat';
const pretty = name => {
  const [base, chat] = name.split('~');
  const nice = base.replace(/[-_]+/g, ' ').replace(/\.+$/, '').replace(/\b[a-z]/g, c => c.toUpperCase());
  return chat ? `${nice} · ${chatTitle(name)}` : nice;
};

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

// Picks a folder on the computer Nexus runs on, which may not be the one showing this page, so the browser's own picker can't help.
// By default the folder opens as a project; pick() does something else with it instead.
const OPEN_HINT = 'Type or paste a path and press Enter to go there. Nexus works in the folder you open and keeps the chat in a .nexus folder inside it. Deleting the project later leaves the folder alone.';
function folderDialog({ title = 'Open a folder', action = 'Open this folder', hint = OPEN_HINT, start = '~', pick } = {}) {
  const err = h('div', { class: 'err', role: 'alert' });
  const input = h('input', { class: 'field mono', id: 'fp', 'aria-describedby': 'fp-hint', spellcheck: false, autocapitalize: 'off', autocomplete: 'off' });
  const list = h('div', { class: 'folders', 'aria-label': 'Folders' });
  const show = async dir => {
    err.textContent = '';
    try {
      const r = await api('GET', `/api/folders?path=${encodeURIComponent(dir)}`);
      input.value = r.path;
      list.replaceChildren(...[r.parent && h('button', { type: 'button', onclick: () => show(r.parent) }, icon('back'), 'Up one folder'),
        ...r.folders.map(f => h('button', { type: 'button', onclick: () => show(f.path) }, icon('folder'), f.name)),
        !r.folders.length && h('p', { class: 'small muted' }, 'No folders in here.')].filter(Boolean));
      list.scrollTop = 0;
    } catch (e) { err.textContent = e.message; }
  };
  let busy = false;
  const run = async () => {
    if (busy) return false;
    busy = true; err.textContent = '';
    try {
      await (pick || openFolderAt)(input.value.trim());
      return true;
    } catch (e) { err.textContent = e.message; return false; } finally { busy = false; }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); show(input.value); } });
  dialog({ title, wide: true, body: h('div', {}, h('label', { class: 'lbl', htmlFor: 'fp' }, 'Folder'), input, list,
    h('p', { class: 'small muted', id: 'fp-hint' }, hint), err),
  actions: [{ label: 'Cancel' }, { label: action, class: 'primary', run }] });
  show(start);
  input.focus();
}
async function openFolderAt(dir) {
  const { name } = await api('POST', '/api/projects/open', { path: dir });
  await refreshProjects();
  go(name, null, 'chat');
}

// With the browser on the Windows PC Nexus runs on, Windows' own Select Folder dialog; on a phone or another computer, the folder browser above.
// While the Windows dialog is open, a small box here says where it is and offers the folder browser instead.
async function chooseFolder(opts = {}) {
  if (!S.me?.pickFolder) return folderDialog(opts);
  const { title = 'Open a folder', button = 'Open', start = '', pick = openFolderAt } = opts;
  const stop = new AbortController();
  let shut;
  dialog({ title, ref: s => { shut = s; }, body: h('p', { class: 'muted' }, "Choose a folder in the Windows window that opened. If you can't see it, it's in the taskbar."),
    actions: [{ label: 'Browse here instead', value: 'here' }, { label: 'Cancel' }] })
    .then(choice => { if (choice === 'done') return; stop.abort(); if (choice === 'here') folderDialog(opts); });
  try {
    const res = await fetch('/api/folders/pick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: `${title} in Nexus`, button, start }), signal: stop.signal });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    shut('done');
    if (json.path) await pick(json.path);
  } catch (e) {
    if (e.name === 'AbortError') return;
    shut('done');
    toast(e.message);
  }
}
const projectDir = name => S.projects.find(p => p.name === name)?.dir;

// The folders a chat works in: its own, plus any added. Added ones get the same tools, approvals and rewind, but not the Files and Changes tabs.
async function foldersDialog(name) {
  const box = h('div', { class: 'folders' });
  let home = '~';
  const show = ({ main, dirs }) => {
    home = main;
    if (S.project === name && S.state) S.state.dirs = dirs;
    box.replaceChildren(h('div', { class: 'frow' }, icon('folder'), h('span', { class: 'grow mono' }, main), h('span', { class: 'small muted' }, 'Main folder')),
      ...dirs.map(d => h('div', { class: 'frow' }, icon('folder'), h('span', { class: 'grow mono' }, d),
        h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Remove ${d}`, onclick: guard(async () => show(await api('DELETE', `${P(name)}/folders`, { path: d }))) }, 'Remove'))));
  };
  const add = () => chooseFolder({ title: 'Add a folder', action: 'Add this folder', button: 'Add', start: home,
    hint: 'Type or paste a path and press Enter to go there. The AI can then read and edit this folder like the project, and rewinding a prompt rewinds it too. It keeps its rewind data in a .nexus folder inside it.',
    pick: async dir => { show(await api('POST', `${P(name)}/folders`, { path: dir })); toast('Added. The AI sees it from your next message.'); } });
  show(await api('GET', `${P(name)}/folders`));
  await dialog({ title: `Folders in ${pretty(name)}`, wide: true, body: h('div', {}, box,
    h('p', { class: 'small muted' }, 'Add folders the AI should work in alongside this one, like a backend next to a frontend. They show in the Files and Changes tabs too.')),
  actions: [{ label: 'Add a folder', run: () => { add(); return false; } }, { label: 'Done', class: 'primary' }] });
  if (S.project === name && S.tab === 'chat' && !S.page) render(); // the new-chat screen lists the folders
}

async function refreshProjects() {
  S.projects = await api('GET', '/api/projects');
  if ($find.value.trim()) return; // search results stay until the box is cleared
  // A question answered on another device clears its mark here.
  for (const p of S.projects) if (S.alerts[p.name] === 'waiting' && !p.waiting) delete S.alerts[p.name];
  syncTitle();
  const heading = !S.page && document.querySelector('.ttl h1'); // a chat's title can arrive with its first message
  if (heading && S.project) heading.textContent = heading.title = pretty(S.project);
  // Each project, then its other chats under it, newest first; a project moves up when any of its chats is used.
  const kids = name => S.projects.filter(p => p.parent === name);
  const latest = p => Math.max(p.updated, ...kids(p.name).map(c => c.updated));
  const tops = S.projects.filter(p => !p.parent).sort((a, b) => latest(b) - latest(a));
  $list.replaceChildren(...tops.flatMap(p => [p, ...kids(p.name)]).map(p => {
    const mark = p.waiting ? 'waiting' : S.alerts[p.name];
    return h('div', { class: `pitem ${p.parent ? 'chat' : ''} ${p.name === S.project && !S.page ? 'on' : ''} ${mark ? 'unseen' : ''}` },
    h('button', { class: 'open', title: p.dir || pretty(p.name), 'aria-current': p.name === S.project ? 'true' : undefined, onclick: () => go(p.name, null, 'chat') },
      h('span', { class: `dot ${p.busy && !p.waiting ? 'busy' : mark === 'waiting' ? 'awaiting' : mark === 'finished' ? 'done' : mark === 'error' ? 'error' : ''}` }), h('span', { class: 'nm' }, p.parent ? p.title || 'New chat' : pretty(p.name)),
      mark === 'waiting' && h('span', { class: 'need' }, 'needs you'), mark === 'finished' && h('span', { class: 'sr' }, ', finished'), mark === 'error' && h('span', { class: 'sr' }, ', stopped on an error')),
    h('button', { class: 'icon-btn', 'aria-label': `Options for ${pretty(p.name)}`, 'aria-haspopup': 'menu', onclick: e => projectMenu(e.currentTarget, p.name) }, icon('dots')));
  }));
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
async function jumpTo(id) {
  while (id && !entries.get(id) && await loadOlder().catch(() => false)) { /* keep loading */ }
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
  !name.includes('~') && h('button', { role: 'menuitem', onclick: () => { close(); newChat(name); } }, icon('plus'), 'New chat'),
  h('button', { role: 'menuitem', onclick: () => { close(); renameDialog(name); } }, icon('pen'), 'Rename'),
  h('button', { role: 'menuitem', onclick: () => { close(); guard(foldersDialog)(name); } }, icon('folder'), 'Folders'),
  h('button', { role: 'menuitem', onclick: () => { close(); memoryDialog(name); } }, icon('bot'), 'Memory'),
  h('button', { role: 'menuitem', onclick: () => { close(); exportChat(name); } }, icon('download'), 'Export chat'),
  S.me?.local && h('button', { role: 'menuitem', onclick: guard(async () => {
    close();
    const { main } = await api('GET', `${P(name)}/folders`);
    location.href = `vscode://file/${encodeURI(main.replace(/\\/g, '/'))}/`;
  }) }, icon('ext'), 'Open in VS Code'),
  h('button', { role: 'menuitem', class: 'danger', onclick: () => { close(); deleteDialog(name); } }, icon('trash'), 'Delete'));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
  menu.querySelector('button').focus();
  setTimeout(() => document.addEventListener('pointerdown', outside));
}

// A new chat in the project, or a fork of a chat from one of its messages, whose text comes back as the draft.
const newChat = guard(async (name, from) => {
  const { name: key, draft } = await api('POST', `${P(name)}/chats`, from ? { from } : {});
  if (draft) drafts[key] = draft;
  await refreshProjects();
  go(key);
  if (from) toast('Forked into a new chat, with your message ready to edit. Both chats share the same project files.');
});

// Live preview: the app the project's dev server serves, through Nexus, here or in its own tab (from a phone too).
// It runs on the preview's own port, so the app can't reach Nexus's API or cookie.
const previewDialog = guard(async () => {
  const project = S.project, key = `nexus.preview.${project.split('~')[0]}`;
  const { ports, previewPort } = await api('GET', `${P(project)}/preview`);
  const start = Number(pref(key)) || ports[0] || '';
  const port = h('input', { class: 'field pvport', type: 'number', min: 1, max: 65535, value: start, id: 'pvport', inputmode: 'numeric' });
  const frame = h('iframe', { class: 'pvframe', title: 'Live preview of the app', hidden: true });
  const tab = h('a', { class: 'btn', target: '_blank', rel: 'noopener', hidden: true }, icon('ext'), 'Open in a new tab');
  const show = guard(async () => {
    const { url } = await api('GET', `${P(project)}/preview?port=${encodeURIComponent(port.value)}`);
    pref(key, port.value);
    Object.assign(frame, { src: url, hidden: false });
    Object.assign(tab, { href: url, hidden: false });
  });
  port.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); show(); } });
  dialog({ title: 'Live preview', wide: true, body: h('div', { class: 'form' },
    h('div', { class: 'rowline' }, h('label', { htmlFor: 'pvport' }, 'Port'), port, h('button', { class: 'btn primary', type: 'button', onclick: show }, 'Show'), tab),
    ports.length ? h('div', { class: 'rowline small muted' }, 'Listening now:', ports.map(p => h('button', { class: 'btn small', type: 'button', onclick: () => { port.value = p; show(); } }, `:${p}`)))
      : h('p', { class: 'small muted' }, 'No dev server found yet. Start one (ask Nexus to run npm run dev in the background, say), then enter its port.'),
    frame,
    h('p', { class: 'small muted' }, `The app runs on Nexus's port ${previewPort}, apart from Nexus itself. To open it from a phone through a tunnel, give that port a public address too and set NEXUS_PREVIEW_URL to it.`)),
  actions: [{ label: 'Close' }] });
  if (start) show();
});

// The project's memory: what chats saved for later chats in this folder (Memory tool), to read, add to and prune.
const memoryDialog = guard(async name => {
  const body = h('div', { class: 'form' });
  const ago = at => { const d = Math.floor((Date.now() - at) / 86_400_000); return d ? `${d} day${d === 1 ? '' : 's'} ago` : 'today'; };
  const render = async () => {
    const { notes } = await api('GET', `${P(name)}/memory`);
    const fact = h('input', { class: 'field grow', id: 'memadd', placeholder: 'Something every chat here should know', maxlength: 400 });
    const add = guard(async () => { await api('POST', `${P(name)}/memory`, { fact: fact.value }); await render(); });
    fact.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    body.replaceChildren(...[
      h('p', { class: 'small muted' }, 'Chats save what later chats in this project should know, like how to run the tests or what you prefer, and every chat here sees these notes. They stay on this computer, outside the project, for six months after they were last saved.'),
      notes.length ? h('div', { class: 'permlist' }, notes.map(n => h('div', { class: 'rowline' }, h('span', { class: 'grow' }, n.fact, h('span', { class: 'small muted' }, ` · ${ago(n.at)}`)),
        h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Forget: ${n.fact}`, onclick: guard(async () => { await api('DELETE', `${P(name)}/memory/${n.id}`); await render(); }) }, 'Forget'))))
        : h('p', { class: 'muted' }, 'Nothing saved yet.'),
      h('div', { class: 'rowline' }, h('label', { class: 'sr', htmlFor: 'memadd' }, 'Add a note'), fact, h('button', { class: 'btn', type: 'button', onclick: add }, 'Add')),
    ]);
  };
  await render();
  dialog({ title: `Memory · ${pretty(name.split('~')[0])}`, wide: true, body, actions: [{ label: 'Close' }] });
});

function renameDialog(name) {
  if (name.includes('~')) return renameChat(name);
  const err = h('div', { class: 'err', role: 'alert' });
  const input = h('input', { class: 'field mono', value: pretty(name), id: 'rn', 'aria-describedby': 'rn-hint', spellcheck: false, autocapitalize: 'off' });
  const save = async () => {
    if (input.value.trim() === pretty(name)) return true;
    const to = input.value.trim().replace(/\s+/g, '-');
    try { await api('POST', `${P(name)}/rename`, { to }); return true; } catch (e) { err.textContent = e.message; return false; }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.closest('dialog').querySelector('.primary').click(); } });
  dialog({ title: 'Rename project', body: h('div', {}, h('label', { class: 'lbl', htmlFor: 'rn' }, 'Name'), input,
    h('p', { class: 'small muted', id: 'rn-hint' }, projectDir(name) ? `Renames the chat. The folder stays at ${projectDir(name)}. Spaces become dashes.` : 'Moves the folder to ~/projects/<name>. Spaces become dashes.'), err),
  actions: [{ label: 'Cancel' }, { label: 'Rename', class: 'primary', run: save }] });
  input.select();
}

function renameChat(key) {
  const input = h('input', { class: 'field', value: chatTitle(key), id: 'rn', maxlength: 80 });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.closest('dialog').querySelector('.primary').click(); } });
  dialog({ title: 'Rename chat', body: h('div', {}, h('label', { class: 'lbl', htmlFor: 'rn' }, 'Title'), input),
    actions: [{ label: 'Cancel' }, { label: 'Rename', class: 'primary', run: guard(async () => { await api('POST', `${P(key)}/rename`, { title: input.value }); await refreshProjects(); }) }] });
  input.select();
}
async function deleteDialog(name) {
  if (name.includes('~')) {
    if (!await confirmBox(`Delete ${pretty(name)}?`, 'Only this chat goes. The project, its files and its other chats stay.', 'Delete', 'danger')) return;
    return guard(async () => { await api('DELETE', P(name)); if (S.project === name) go(name.split('~')[0]); await refreshProjects(); })();
  }
  const where = projectDir(name);
  if (!await confirmBox(where ? `Remove ${pretty(name)}?` : `Delete ${pretty(name)}?`, where ? `Nexus stops showing it. The folder, its files and the chat saved in its .nexus stay at ${where}; open the folder again to pick up where you left off.`
    : 'The folder moves to ~/projects/.trash, where you can still recover it by hand.', where ? 'Remove' : 'Delete', 'danger')) return;
  await guard(async () => {
    await api('DELETE', P(name));
    if (S.project === name) go(null);
    await refreshProjects();
  })();
}

// ---- navigation ----
function go(project, page = null, tab = 'chat') {
  drawer(false);
  dictation?.abort();
  if (project !== S.project) teardownTerm();
  const changed = project !== S.project;
  const moved = changed || page !== S.page;
  S.project = project; S.page = page; S.tab = tab;
  if (changed) syncQuality?.();
  // Coming back to a chat that finished or stopped while you were elsewhere: offer a recap of what happened.
  if (project && !page && tab === 'chat' && ['finished', 'error'].includes(S.alerts[project])) toast(`${pretty(project)} ${S.alerts[project] === 'error' ? 'stopped on an error' : 'finished'} while you were away.`, ['Recap', () => sendWs({ t: 'send', text: '/recap' })], 10000);
  if (project && !page && tab === 'chat' && S.alerts[project]) { delete S.alerts[project]; syncTitle(); }
  history.replaceState(null, '', page ? `#/${page}` : project ? `#/p/${encodeURIComponent(project)}/${tab}` : '#/');
  if (changed && project) { S.state = null; S.meta.qualityPresets = undefined; sendWs({ t: 'open', name: project }); guard(loadMeta)(); }
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

function navigateTabs(e, tabs, at) {
  const next = { ArrowRight: (at + 1) % tabs.length, ArrowLeft: (at + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  const id = tabs[next][0];
  go(S.project, null, id);
  document.getElementById(`tab-${id}`).focus();
}

let prevTab = 0;
function render() {
  document.getElementById('nav-agents').classList.toggle('on', S.page === 'agents');
  document.getElementById('nav-settings').classList.toggle('on', S.page === 'settings');
  document.getElementById('nav-market').classList.toggle('on', S.page === 'marketplace');
  syncTitle();
  const hamb = h('button', { class: 'icon-btn hamb', 'aria-label': 'Open menu', 'aria-controls': 'workspace-sidebar', 'aria-expanded': String($side.classList.contains('open')), onclick: () => drawer(true) }, icon('menu'));
  if (S.page === 'agents') return agentsPage(hamb);
  if (S.page === 'marketplace') return marketPage(hamb);
  if (S.page === 'settings') return settingsPage(hamb);
  if (!S.project) {
    return $main.replaceChildren(h('header', { class: 'top' }, hamb, h('h1', {}, 'Nexus')),
      h('div', { class: 'empty' }, h('h2', {}, 'Start a project'), h('p', {}, 'Each conversation gets its own folder in ~/projects, or works in a folder you already have.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: guard(newProject) }, icon('plus'), 'New project'),
          h('button', { class: 'btn', onclick: () => chooseFolder() }, icon('folder'), 'Open a folder'),
          h('button', { class: 'btn', onclick: cloneDialog }, icon('download'), 'Clone a repo'))));
  }
  const tabs = [['chat', 'Chat'], ['files', 'Files'], ['changes', 'Changes'], ['terminal', 'Terminal']];
  const at = tabs.findIndex(([id]) => id === S.tab);
  const view = h('div', { class: 'view', id: 'project-view', role: 'tabpanel', 'aria-labelledby': `tab-${S.tab}` });
  const pill = h('span', { class: 'pill', style: `--i:${at}`, 'aria-hidden': 'true' });
  $main.replaceChildren(h('header', { class: 'top' }, hamb,
    h('div', { class: 'ttl' }, h('h1', { title: pretty(S.project) }, pretty(S.project)), projectDir(S.project) && h('span', { class: 'sub muted', title: projectDir(S.project) }, projectDir(S.project).split(/[\\/]/).slice(-2).join('/'))),
    h('span', { class: 'spin', 'aria-hidden': 'true' }),
    h('button', { class: 'icon-btn', 'aria-label': `Options for ${pretty(S.project)}`, onclick: e => projectMenu(e.currentTarget, S.project) }, icon('dots')),
    h('button', { class: 'icon-btn', 'aria-label': 'Live preview of the app', title: 'Live preview', onclick: () => previewDialog() }, icon('globe')),
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Project views', onkeydown: e => navigateTabs(e, tabs, at) }, pill,
      tabs.map(([id, label]) => h('button', { class: `tab ${S.tab === id ? 'on' : ''}`, id: `tab-${id}`, role: 'tab', 'aria-selected': String(S.tab === id), 'aria-controls': 'project-view', tabIndex: S.tab === id ? 0 : -1, onclick: () => go(S.project, null, id) }, label)))),
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
  const n = Object.keys(S.alerts).length;
  document.title = `${n ? `(${n}) ` : ''}${S.state?.running ? '● ' : doneUnseen ? '✓ ' : ''}${base}`;
}
function finished() {
  if (!document.hidden) return;
  doneUnseen = true;
}
// The chat on screen counts as seen once you're looking at it again.
const seen = () => {
  if (!document.hidden && S.project && !S.page && S.tab === 'chat' && S.alerts[S.project]) { delete S.alerts[S.project]; refreshSoon(); }
  syncTitle();
};
document.addEventListener('visibilitychange', () => { sendWs({ t: 'visible', on: !document.hidden }); if (!document.hidden) { doneUnseen = false; seen(); } });

// A chat that finishes or needs an answer while you look elsewhere: a mark in the sidebar, a toast that opens it, a count in the title,
// and a system notification when Nexus is in the background and notifications are on in Settings.
function notice({ project, kind, body, notify }) {
  if (project === S.project && !S.page && S.tab === 'chat' && !document.hidden) return; // you're watching it
  if (kind === 'waiting' || S.alerts[project] !== 'waiting') S.alerts[project] = kind;
  refreshSoon();
  syncTitle();
  const title = `${pretty(project)} ${kind === 'waiting' ? 'needs your answer' : kind === 'error' ? 'stopped on an error' : 'finished'}`;
  if (!document.hidden) return toast(`${title}. ${body}`, ['Open', () => go(project, null, 'chat')], kind === 'waiting' ? 12000 : 6000);
  // This computer shows its own notification for a browser on it, so the browser doesn't add a second one.
  if ((kind !== 'error' || notify === true) && !S.me?.desktopNotify && pref('nexus.notify') === '1' && window.Notification?.permission === 'granted') {
    new Notification(title, { body, icon: '/icon-180.png', tag: `nexus-${project}` }).onclick = () => { focus(); go(project, null, 'chat'); };
  }
}

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
  const bytes = b => Array.from(new Uint8Array(b || [])).join();
  const had = old?.options?.applicationServerKey; // a browser that can't say keeps its subscription, as before
  const keep = old && (!had || bytes(had) === bytes(raw));
  if (old && !keep) { await api('POST', '/api/push/unsubscribe', { endpoint: old.endpoint }).catch(() => {}); await old.unsubscribe(); }
  const sub = keep ? old : await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
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
    ws.send(JSON.stringify({ t: 'visible', on: !document.hidden }));
    if (S.project) ws.send(JSON.stringify({ t: 'open', name: S.project }));
    refreshSoon();
  };
  ws.onmessage = e => {
    lastHeard = Date.now();
    const m = JSON.parse(e.data);
    if (m.t === 'suggest' && S.state) S.state.suggestions = m.items;
    onEvent(m);
    if (['state', 'status', 'suggest'].includes(m.t)) syncSuggest();
  };
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
const sendWs = m => {
  if (S.ws?.readyState !== 1) return false;
  S.ws.send(JSON.stringify(m));
  return true;
};

function onEvent(m) {
  switch (m.t) {
    case 'state':
      if (m.state.name !== S.project) return;
      { const first = !S.state;
        const prev = S.state?.name === m.state.name && $log?.isConnected && S.tab === 'chat' && !S.page
          ? { log: S.state.log, top: $log.scrollTop, bottom: nearBottom(), open: [...entries].filter(([, r]) => r.el.open).map(([id]) => id) } : null;
        S.state = m.state;
        const i = prev ? prev.log.findIndex(e => e.id === m.state.log[0]?.id) : -1;
        if (i > 0) { S.state.log = [...prev.log.slice(0, i), ...m.state.log]; S.state.older = Math.max(0, m.state.older - i); }
        if (S.tab === 'chat' && !S.page) {
          if ($input?.isConnected) { syncTitle(); syncChat(); } else render();
          if (first) motion($log, FADE);
          if (prev) { for (const id of prev.open) { const r = entries.get(id); if (r) r.el.open = true; } if (!prev.bottom) $log.scrollTop = prev.top; }
          if (S.jump) { jumpTo(S.jump); S.jump = null; }
        } }
      break;
    case 'entry': {
      if (!S.state) return;
      const i = S.state.log.findLastIndex(x => x.id === m.entry.id);
      if (i >= 0) S.state.log[i] = m.entry;
      else if (m.added || !S.state.older) S.state.log.push(m.entry);
      else break; // an update to an older entry the page hasn't loaded
      upsertEntry(m.entry);
      if (m.entry.type === 'tool' && !['running', 'awaiting'].includes(m.entry.status)) filesChanged();
      break;
    }
    case 'delta': delta(m); break;
    case 'status': {
      const was = S.state?.running;
      if (S.state) Object.assign(S.state, { running: m.running, usage: m.usage, todos: m.todos, mode: m.mode, model: m.model, effort: m.effort, quality: m.quality, agent: m.agent, autopilot: m.autopilot, budget: m.budget, compactAt: m.compactAt, dirs: m.dirs, allow: m.allow });
      if (was && !m.running) { finished(); refreshReview(); filesChanged(); }
      if (m.running && $review) $review.hidden = true;
      syncTitle();
      syncComposer();
      break;
    }
    case 'reset':
      if (m.state) S.state = m.state; else if (S.state) Object.assign(S.state, { log: [], older: 0 });
      if (S.tab === 'chat' && !S.page) render();
      break;
    case 'projects': refreshSoon(); break;
    case 'alert': notice(m); break;
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
let $log, $todos, $input, $sendBtn, $stopBtn, $mode, $modeLabel, $autoBtn, $model, $modelLabel, $qualityBtn, $qualityLabel, $agentBtn, $agentLabel, $promptBtn, $meter, $thumbs, $slash;

function chatView(view) {
  $log = h('div', { class: 'log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  $log.addEventListener('touchstart', stopFollow, { passive: true });
  $log.addEventListener('wheel', stopFollow, { passive: true });
  // Pasted images finish loading after the first scroll to the bottom, so the log stays there while you haven't scrolled up.
  let atBottom = true;
  $log.addEventListener('scroll', () => { atBottom = nearBottom(); }, { passive: true });
  for (const type of ['load', 'error']) $log.addEventListener(type, () => { if (atBottom) $log.scrollTop = $log.scrollHeight; }, true);
  $todos = h('div', { class: 'todos', hidden: true });
  $review = h('div', { class: 'review', hidden: true, role: 'region', 'aria-label': 'Changes to review' });
  view.append($log, $todos, $review, composer());
  syncChat();
  if (matchMedia('(hover: hover)').matches) $input.focus();
}

// Refresh snapshots without replacing the composer during an in-flight click or tap.
function syncChat() {
  entries.clear();
  $log.replaceChildren();
  if (S.state) {
    if (S.state.older) $log.append(olderButton());
    if (!S.state.log.length) $log.append(hello());
    for (const e of S.state.log) upsertEntry(e, false);
  }
  refreshReview();
  syncComposer();
  $log.scrollTop = $log.scrollHeight;
}

// Older entries of a long chat load a page at a time, above what you are reading, without moving it.
const olderButton = () => h('button', { class: 'btn small older', type: 'button', onclick: guard(loadOlder) }, `Show earlier messages (${S.state.older})`);
async function loadOlder() {
  const project = S.project, first = S.state?.log[0], btn = $log?.querySelector('.older');
  if (!first || !S.state.older || !btn || btn.disabled) return false;
  btn.disabled = true;
  try {
    const { entries: list, older } = await api('GET', `${P(project)}/log?before=${encodeURIComponent(first.id)}`);
    if (project !== S.project || S.state.log[0] !== first) return false;
    const height = $log.scrollHeight;
    S.state.log.unshift(...list);
    S.state.older = older;
    btn.after(...list.map(e => { const el = renderEntry(e); entries.set(e.id, { el, e }); return el; }));
    if (older) btn.textContent = `Show earlier messages (${older})`; else btn.remove();
    $log.scrollTop += $log.scrollHeight - height;
    return true;
  } finally { btn.disabled = false; }
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

// A new chat offers a few first prompts: for exploring code that is already there, or for starting from nothing.
// They only fill the message box, so they can be finished or changed before sending.
const STARTERS = {
  code: [['Explain this project', 'Explain how this project is put together: the main parts, how they connect, and where a newcomer should start reading.'],
    ['Find and fix a bug', 'Find a real bug in this code. Explain it, fix it with the smallest change, and add a test that fails without the fix.'],
    ['Write missing tests', 'Find the most important code that has no tests, write tests for it, and run them.'],
    ['Review my changes', '/review']],
  empty: [['Build a web page', 'Build a single-page website about '], ['Make a command-line tool', 'Make a small command-line tool that '],
    ['Start from a GitHub repo', null], ['Plan an idea', 'Help me plan this project, step by step: ']],
};
function hello() {
  const starters = h('div', { class: 'starters' });
  const el = h('div', { class: 'empty', id: 'hello' }, h('h2', {}, 'What should we build?'), h('p', { class: 'mono' }, projectDir(S.project) || `~/projects/${S.project}`),
    S.state?.dirs?.map(d => h('p', { class: 'mono small muted' }, `+ ${d}`)), starters,
    h('p', { class: 'small' }, 'Type a request. / runs a command, @ points at a file and ! runs a shell command.'));
  const project = S.project;
  S.modelsReady?.then(() => {
    if (!el.isConnected || project !== S.project || !S.state || S.models.some(m => m.id === S.state.model)) return;
    el.append(h('p', { class: 'small note' }, S.models.length ? `${S.state.model} isn't one of the models your keys can use. ` : 'No model is connected yet. ',
      S.models.length ? h('button', { class: 'linkbtn', type: 'button', onclick: modelPicker }, 'Pick a model') : h('button', { class: 'linkbtn', type: 'button', onclick: () => go(null, 'settings') }, 'Add an API key in Settings')));
  });
  api('GET', `${P(project)}/files?q=`).catch(() => []).then(files => {
    if (project !== S.project || !el.isConnected) return;
    starters.replaceChildren(...STARTERS[files.length ? 'code' : 'empty'].map(([label, text]) => h('button', { class: 'starter', type: 'button', onclick: () => {
      if (!text) return cloneDialog();
      $input.value = drafts[S.project] = text;
      grow();
      $input.focus();
      $input.setSelectionRange(text.length, text.length);
    } }, label)));
  });
  return el;
}

let mdPending = new Set();
function delta(m) {
  const rec = entries.get(m.id);
  const stick = $log?.isConnected && nearBottom();
  const logged = S.state?.log.findLast(x => x.id === m.id);
  if (m.kind === 'output') {
    if (logged) logged.output = ((logged.output || '') + m.text).slice(-60000);
    const live = rec?.el.querySelector('.live');
    if (live) { live.append(m.text); if (live.textContent.length > 120000) live.textContent = logged?.output ?? live.textContent.slice(-60000); }
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

// A tool row's icon, then its verb while waiting or refused, once done and while running. Only a finished call reads as past tense.
const TOOL_ROWS = {
  Bash: ['term', 'Run', 'Ran', 'Running'], Read: ['file', 'Read', 'Read', 'Reading'], Edit: ['pen', 'Edit', 'Edited', 'Editing'], Write: ['pen', 'Write', 'Wrote', 'Writing'],
  Grep: ['search', 'Search', 'Searched', 'Searching'], Glob: ['search', 'Search', 'Searched', 'Searching'], WebFetch: ['globe', 'Fetch', 'Fetched', 'Fetching'],
};
const toolVerb = e => TOOL_ROWS[e.name]?.[e.status === 'done' ? 2 : e.status === 'running' ? 3 : 1] || e.name;
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
    // A risky call asks every time, so it has no "always allow".
    e.risk && h('div', { class: 'q note' }, `High risk (${e.risk.score}/10): ${e.risk.why} The agent looked for a safer way and found none.`),
    h('div', { class: 'q' }, `Allow ${e.name}?`), toolArgs(e), why, h('div', { class: 'row' },
      h('button', { class: 'btn small primary', onclick: () => reply({ decision: 'allow' }) }, 'Allow once'),
      !e.risk && h('button', { class: 'btn small', onclick: () => reply({ decision: 'always' }) }, e.name === 'Bash' ? 'Always allow this exact command' : 'Always allow'),
      h('button', { class: 'btn small danger', onclick: () => reply({ decision: 'deny', message: why.value }) }, 'Deny')));
}

// Images in the log are files in the chat's .nexus/images ("images/<hash>.png"); older entries may still hold data URLs.
const imageSrc = src => (/^images\/[a-f0-9]{32}\.\w+$/.test(src) ? `${P(S.project)}/${src}` : src);
function renderEntry(e) {
  switch (e.type) {
    case 'user': {
      const rw = !e.queued && e.cp !== undefined && h('button', { class: 'icon-btn rw', 'aria-label': 'Rewind to this prompt', title: 'Rewind to here', onclick: () => rewindDialog(e) }, icon('undo'));
      const fork = !e.queued && e.cp !== undefined && h('button', { class: 'icon-btn rw fork', 'aria-label': 'Fork a new chat from this prompt', title: 'Fork a new chat from here', onclick: () => newChat(S.project, e.id) }, icon('fork'));
      const tag = e.injected && h('span', { class: 'itag', title: 'Your standing instructions from Prompts were added to this message' }, '+ injected');
      return h('div', { class: `e user ${e.queued ? 'queued' : ''}` }, e.text, (e.images || []).map(src => h('img', { src: imageSrc(src), alt: 'Attachment' })), tag, fork, rw);
    }
    case 'assistant': {
      const md = h('div', { class: 'md' });
      markdown(md, e.text, e.status !== 'running');
      return h('div', { class: `e assistant${e.side ? ' side' : ''}` }, e.side && h('div', { class: 'small muted' }, e.recap ? 'Recap of what happened since your last message' : 'Side answer, not part of the conversation'), md);
    }
    case 'reasoning': {
      const md = h('div', { class: 'md small muted' });
      markdown(md, e.text, false);
      return h('details', { class: 'e fold reason' }, h('summary', {}, e.status === 'running' ? 'Thinking…' : 'Thought'), md);
    }
    case 'tool': {
      const awaiting = e.status === 'awaiting';
      const d = h('details', { class: 'e fold tool', open: awaiting || e.status === 'error' || e.status === 'held' || e.direct || e.name === 'ExitPlanMode' || e.name === 'Screenshot' },
        h('summary', {}, h('span', { class: `dot ${e.status}`, title: e.status }, icon(TOOL_ROWS[e.name]?.[0] || 'spark')),
          h('span', { class: 'tname', title: e.name }, toolVerb(e)), h('span', { class: 'targ muted' }, String(toolTarget(e.name, e.args || {})).split('\n')[0]),
          e.autopilot && h('span', { class: 'aptag', title: 'Autopilot answered this for you' }, 'autopilot'),
          e.risk && h('span', { class: 'rtag', title: e.risk.why }, e.status === 'held' ? `held · risk ${e.risk.score}/10` : `risk ${e.risk.score}/10`),
          e.agent && h('span', { class: 'tagent muted' }, e.agent)));
      if (awaiting) d.append(askBox(e));
      else {
        if (e.status === 'denied') d.open = true;
        // A closed fold gets its arguments and output only when opened: a long chat has thousands of them.
        const fill = () => {
          const args = toolArgs(e);
          if (args) d.append(args);
          if (e.images) d.append(...e.images.map(src => h('img', { class: 'seen', src: imageSrc(src), alt: 'The image the agent looked at' })));
          else if (e.status === 'running' || e.output) d.append(h('div', { class: 'out live' }, e.output || ''));
        };
        if (d.open) fill(); else d.addEventListener('toggle', fill, { once: true });
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
  ['help', 'Show commands and keys'], ['doctor', 'Check that everything Nexus needs is set up'], ['recap', 'Sum up what happened since your last message'], ['btw', 'Ask something on the side, even while the agent works'], ['clear', 'Start over, archiving the transcript'], ['compact', 'Summarize to free up context'], ['autocompact', 'Turn auto-compact on or off, or set its size'],
  ['model', 'Show or set the model'], ['effort', 'low, medium, high, xhigh or max'], ['mode', 'default, acceptEdits, plan, readonly or bypass'], ['plan', 'Research only, then propose a plan'],
  ['cost', 'Show tokens used and cost'], ['budget', 'Dollars: stop once this chat has cost that much'], ['init', 'Write a NEXUS.md for this project'], ['pr', 'Commit, push and open a GitHub pull request'], ['issue', 'Fix a GitHub issue by number'], ['schedule', 'Run a prompt on a timer: cron fields, then the prompt'], ['check', 'A command, like npm test, to run after each change; Nexus fixes failures'], ['watch', 'on or off: act on comments ending in AI! saved in any editor'], ['todos', 'Show the task list'],
  ['files', 'Open the Files tab'], ['changes', 'Open the Changes tab'], ['terminal', 'Open the terminal'], ['agents', 'Open agent management'],
  ['skills', 'List skills and agents'], ['mcp', 'Open MCP and hook settings'], ['settings', 'Open settings'], ['memory', 'Edit NEXUS.md'], ['rewind', 'How to rewind'],
  ['create-agent', 'Have the AI write a new agent type'], ['create-skill', 'Have the AI write a new skill'], ['agent', 'Switch this chat to another agent'], ['prompts', 'Edit system prompts and injected text'],
  ['marketplace', 'Browse agents and MCP servers to add'], ['export', 'Download this chat as Markdown'], ['autopilot', 'on or off: keep working without stopping to ask'],
];
const slashItems = () => [
  ...BUILTIN.map(([name, description]) => ({ name, description })),
  ...S.meta.commands, ...S.meta.skills.filter(k => !k.off),
];
function localCommand(text) {
  const cmd = text.slice(1).trim();
  if (['files', 'changes', 'terminal'].includes(cmd)) { go(S.project, null, cmd); return true; }
  if (['agents', 'skills'].includes(cmd)) { go(S.project, 'agents'); return true; }
  if (['settings', 'mcp'].includes(cmd)) { go(S.project, 'settings'); return true; }
  if (cmd === 'memory') { pendingOpen = 'NEXUS.md'; go(S.project, null, 'files'); return true; }
  if (cmd === 'rewind') { toast('Use the rewind arrow on the prompt you want to go back to.'); return true; }
  if (cmd === 'doctor') { doctorDialog(); return true; }
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
  fileHits = { q: null, files: [] };
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

// In the order the 1-5 keys pick them. `can` answers CAN_DO for each mode and has to match decide() in server/tools.js; a test holds it to that.
const CAN_DO = ['Reads', 'Edits', 'Commands', 'Web'];
const MODES = [
  { id: 'default', label: 'Ask first', group: 'Ask me', icon: 'shield', about: 'Reads project files on its own and asks before anything else.', words: 'normal safe approve', can: ['auto', 'ask', 'ask', 'ask'] },
  { id: 'acceptEdits', label: 'Accept edits', group: 'Ask me', icon: 'pen', about: 'Edits files in the project without asking. Commands still ask.', words: 'write change code', can: ['auto', 'auto', 'ask', 'ask'] },
  { id: 'plan', label: 'Plan', group: "Look, don't touch", icon: 'file', about: 'Researches and writes a plan for you to approve, then gets to work.', words: 'research think design', can: ['auto', 'blocked', 'blocked', 'ask'] },
  { id: 'readonly', label: 'Read-only', group: "Look, don't touch", icon: 'eye', about: 'Only reads files and answers. It stays this way until you switch.', words: 'question review explain safe', can: ['auto', 'blocked', 'blocked', 'blocked'] },
  { id: 'bypass', label: 'Bypass', group: 'Hands off', icon: 'bolt', about: 'Runs every command and changes any file on this machine without asking.', words: 'yolo danger everything', can: ['auto', 'auto', 'auto', 'auto'] },
];
const setMode = async value => {
  if (value === 'bypass' && S.state.mode !== 'bypass' && !await confirmBox('Turn on bypass mode?', 'The agent will run every command and change any file on this machine without asking.', 'Turn on', 'danger')) return false;
  setOption('mode', value);
  return true;
};
const toggleAutopilot = async () => {
  if (!S.state.autopilot && !await confirmBox('Turn on autopilot?', `The agent stops asking you. It runs commands and edits files without approval, approves its own plan in plan mode, and answers its own questions, until the task is done or it hits the autopilot request limit (150 by default; change it in Settings → Autopilot request limit). Plan mode still can't change anything before the plan. Stop works as usual.`, 'Turn on', 'danger')) return;
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
// /doctor: what this install needs and whether it has it, each with its fix.
const doctorDialog = guard(async () => {
  const body = h('div', { class: 'form' }, h('p', { class: 'muted' }, 'Checking…'));
  dialog({ title: 'Doctor', wide: true, body, actions: [{ label: 'Close' }] });
  const { checks } = await api('GET', '/api/doctor');
  const mark = { ok: ['✓', 'done'], warn: ['!', 'awaiting'], fail: ['✕', 'error'] };
  const bad = checks.filter(c => c.state === 'fail').length, warn = checks.filter(c => c.state === 'warn').length;
  body.replaceChildren(h('p', { class: 'title' }, bad ? `${bad} problem${bad === 1 ? '' : 's'} to fix` : warn ? 'Working, with a few things missing' : 'Everything Nexus needs is here'),
    h('div', { class: 'permlist' }, checks.map(c => h('div', { class: 'rowline' }, h('span', { class: `dot ${mark[c.state][1]}`, 'aria-hidden': 'true' }),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, c.name), h('span', { class: 'sr' }, `: ${c.state}`), h('div', { class: 'small muted' }, c.detail))))));
});

// Suggested replies from the server after a turn: tap one to send it.
let $suggest = null;
function syncSuggest() {
  if (!$suggest?.isConnected) return;
  const items = !S.state?.running && Array.isArray(S.state?.suggestions) ? S.state.suggestions : [];
  $suggest.replaceChildren(...items.map(text => h('button', { class: 'btn small', type: 'button', onclick: () => { sendWs({ t: 'send', text }); S.state.suggestions = []; syncSuggest(); } }, text)));
  $suggest.hidden = !items.length;
}
function composer() {
  fileHits = { q: null, files: [] };
  $input = h('textarea', { rows: 1, placeholder: 'Message Nexus', 'aria-label': 'Message', oninput: () => { drafts[S.project] = $input.value; grow(); updateSlash(); },
    onpaste: e => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); addFiles(f); } },
    onkeydown: e => {
      if (!$slash.hidden && !e.isComposing) {
        const items = [...$slash.children];
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); slashIndex = (slashIndex + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; updateSlash(); return; }
        if (e.key === 'Tab' || (e.key === 'Enter' && $slash.dataset.mode === '@')) { e.preventDefault(); items[slashIndex].click(); return; }
        if (e.key === 'Escape') { e.stopPropagation(); $slash.hidden = true; return; }
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
  $modeLabel = h('span', { class: 'mlabel' });
  $mode = h('button', { type: 'button', 'aria-label': 'Permission mode', 'aria-haspopup': 'dialog', title: 'Permission mode (Shift+Tab)', onclick: guard(() => modePicker()) }, $modeLabel, icon('down'));
  $autoBtn = h('button', { class: 'icon-btn apbtn', type: 'button', 'aria-label': 'Autopilot', onclick: guard(toggleAutopilot) }, icon('plane'));
  $agentLabel = h('span', { class: 'mlabel' });
  $agentBtn = h('button', { class: 'mbtn abtn', type: 'button', 'aria-label': 'Choose the agent for this chat', onclick: guard(agentPicker) }, icon('bot'), $agentLabel, icon('down'));
  $promptBtn = h('button', { class: 'icon-btn pbtn', type: 'button', 'aria-label': 'System prompts and injected text', title: 'Prompts', onclick: guard(() => promptsDialog()) }, icon('sliders'));
  $modelLabel = h('span', { class: 'mlabel' });
  $model = h('button', { class: 'mbtn', type: 'button', 'aria-label': 'Choose model and effort', title: 'Model and effort', onclick: modelPicker }, $modelLabel, icon('down'));
  $qualityLabel = h('span', { class: 'mlabel' }, 'Loading…');
  $qualityBtn = h('button', { class: 'mbtn qbtn', type: 'button', disabled: true, 'aria-label': 'Build quality is loading', 'aria-haspopup': 'dialog', title: 'Build quality is loading', onclick: () => qualityPicker() }, h('span', { class: 'qcaption' }, 'Build quality ·'), $qualityLabel, icon('down'));
  $meter = h('button', { class: 'meter', type: 'button', onclick: tokenPanel });
  $sendBtn = h('button', { class: 'btn small primary', type: 'button', 'aria-label': 'Send', title: 'Send', onmousedown: e => e.preventDefault(), onclick: send }, 'Send');
  $suggest = h('div', { class: 'suggest', hidden: true, role: 'group', 'aria-label': 'Suggested replies' });
  // The prompt enhancer: rewrites the draft into a clear, specific request, which stays in the box to check before sending.
  const enhance = h('button', { class: 'icon-btn enh', type: 'button', 'aria-label': 'Improve this prompt', title: 'Improve this prompt with AI', onclick: guard(async () => {
    if (!$input.value.trim()) return toast('Write a request first, then this rewrites it into a clearer one.');
    enhance.disabled = true;
    try {
      const before = $input.value;
      const { text } = await api('POST', `${P(S.project)}/enhance`, { text: before });
      $input.value = drafts[S.project] = text; grow(); $input.focus();
      toast('Rewrote your prompt. Check it, then send.', ['Undo', () => { $input.value = drafts[S.project] = before; grow(); }], 8000);
    } finally { enhance.disabled = false; }
  }) }, icon('spark'));
  $stopBtn = h('button', { class: 'btn small danger', type: 'button', 'aria-label': 'Stop', title: 'Stop', hidden: true, onclick: () => sendWs({ t: 'interrupt' }) }, 'Stop');
  syncThumbs();
  return h('div', { class: 'composer' }, $suggest, $slash, h('div', { class: 'cbox' }, $thumbs, $input, h('div', { class: 'cbar' },
    h('button', { class: 'icon-btn att', type: 'button', 'aria-label': 'Attach image', title: 'Attach image', onclick: () => file.click() }, icon('plus')), file,
    Speech && h('button', { class: 'icon-btn mic', type: 'button', 'aria-label': 'Dictate', 'aria-pressed': 'false', title: "Dictate: speak and it types (your browser's speech recognition)", onclick: e => dictate(e.currentTarget) }, icon('mic')),
    $mode, $autoBtn, $agentBtn, $model, $qualityBtn, $promptBtn, enhance, $meter, $stopBtn, $sendBtn)));
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Price per million tokens, input and output; OpenRouter marks routers with a negative price.
const isFree = m => m.price?.length === 2 && m.price.every(p => p === 0);
const priceText = m => (m.price?.every(p => p >= 0) && !isFree(m) ? `$${+m.price[0].toFixed(2)} in · $${+m.price[1].toFixed(2)} out per M` : '');
const tokens = n => (n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}K`);
function setOption(key, value) {
  if (!S.state) return false;
  let sent;
  try { sent = sendWs({ t: 'option', key, value }); } catch { sent = false; }
  if (!sent) { toast('Not connected. Reconnect, then try again.'); return false; }
  S.state[key] = value;
  syncComposer();
  return true;
}

// Public metadata only: never duplicate the server's guidance or offer unknown presets.
function qualityPresets() {
  const presets = S.meta?.qualityPresets, ids = ['personal', 'shared', 'commercial'];
  if (!Array.isArray(presets) || presets.length !== ids.length) return [];
  return ids.every(id => presets.some(p => p?.id === id && ['label', 'subtitle', 'description'].every(k => typeof p[k] === 'string' && p[k].trim())))
    ? ids.map(id => presets.find(p => p.id === id)) : [];
}
let syncQuality = null;
function qualityPicker() {
  const presets = qualityPresets(), project = S.project, opener = $qualityBtn;
  if (!project || !S.state || syncQuality || !presets.some(p => p.id === (S.state.quality || 'personal'))) return;
  const shut = () => sheet(d)();
  const rows = presets.map(p => {
    const selected = h('span', { class: 'qselected', hidden: true }, '✓ Selected');
    const button = h('button', { class: 'mrow qcard', type: 'button', 'aria-pressed': 'false', onclick: () => {
      if (S.project !== project || !S.state || !qualityPresets().some(item => item.id === p.id)) return shut();
      if (p.id === (S.state.quality || 'personal') || setOption('quality', p.id)) shut();
    } }, h('span', { class: 'mtext' }, h('span', { class: 'qname' }, p.label, selected), h('span', { class: 'qsubtitle' }, p.subtitle), h('span', { class: 'qabout' }, p.description)));
    return { id: p.id, button, selected };
  });
  const list = h('div', { class: 'mlist qlist', role: 'group', 'aria-label': 'Build quality presets' }, rows.map(r => r.button));
  const d = h('dialog', { class: 'picker quality', 'aria-label': 'Build quality', 'aria-describedby': 'quality-guidance quality-notes',
    onclick: e => { if (e.target === d) shut(); },
    oncancel: e => { e.preventDefault(); shut(); },
    onclose: () => { syncQuality = null; d.remove(); if (S.project === project && opener.isConnected) opener.focus(); },
    onkeydown: e => {
      const buttons = rows.map(r => r.button), at = buttons.indexOf(document.activeElement);
      if (at < 0) return;
      const next = { ArrowDown: (at + 1) % buttons.length, ArrowUp: (at + buttons.length - 1) % buttons.length, Home: 0, End: buttons.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault(); buttons[next].focus();
    } },
    h('div', { class: 'mhead' }, h('h2', {}, 'Build quality'), h('button', { class: 'btn small', type: 'button', onclick: shut }, 'Done')),
    h('p', { class: 'qintro muted', id: 'quality-guidance' }, 'These guide planning and checks; permissions stay unchanged.'), list,
    h('div', { class: 'mfoot qnotes muted', id: 'quality-notes' }, h('p', {}, 'Applies to the next AI request in this chat.'), h('p', {}, 'Commercial is not a guarantee your product is ready to sell.')));
  syncQuality = () => {
    const current = S.state?.quality || 'personal';
    if (S.project !== project || !S.state || !qualityPresets().some(p => p.id === current)) return shut();
    for (const row of rows) {
      const selected = row.id === current;
      row.button.classList.toggle('current', selected);
      row.button.setAttribute('aria-pressed', String(selected));
      row.selected.hidden = !selected;
    }
  };
  syncQuality();
  document.body.append(d);
  d.showModal();
  rows.find(r => r.id === (S.state.quality || 'personal')).button.focus();
}

// Turns a saved rule such as Bash:npm test or Read:* into its tool and what it covers.
const ruleParts = rule => {
  const at = rule.indexOf(':');
  if (at < 0) return [rule, 'every use'];
  const what = rule.slice(at + 1);
  return [rule.slice(0, at), what === '*' ? 'any file in this project' : what];
};

function modePicker() {
  const shut = () => sheet(d)();
  const pick = async id => { if (await setMode(id)) shut(); };
  const row = m => {
    const current = m.id === S.state.mode;
    return h('button', { class: `mrow${current ? ' current' : ''}`, type: 'button', 'aria-current': current ? 'true' : null, onclick: () => pick(m.id) }, icon(m.icon),
      h('span', { class: 'mtext' }, h('span', { class: 'mname' }, m.label),
        h('span', { class: 'mabout' }, m.about),
        h('span', { class: 'mcan' }, CAN_DO.map((what, i) => h('span', { class: `can is-${m.can[i]}` }, `${what}: ${m.can[i]}`)))),
      current ? icon('check') : h('kbd', { class: 'mkey', 'aria-hidden': 'true' }, MODES.indexOf(m) + 1));
  };
  const autoRow = () => h('button', { class: `mrow autorow${S.state.autopilot ? ' current' : ''}`, type: 'button', 'aria-pressed': String(Boolean(S.state.autopilot)),
    onclick: guard(async () => { await toggleAutopilot(); render(); list.querySelector('.autorow').focus(); }) }, icon('plane'),
    h('span', { class: 'mtext' }, h('span', { class: 'mname' }, 'Autopilot', S.state.autopilot && h('span', { class: 'mtag' }, 'On')),
      h('span', { class: 'mabout' }, "Answers its own prompts until the task is done, on top of any mode. What a mode blocks stays blocked.")));
  const ruleRow = rule => {
    const [tool, what] = ruleParts(rule);
    return h('div', { class: 'mrule' }, h('span', { class: 'mtag' }, tool), h('span', { class: 'mfacts', title: rule }, what),
      h('button', { class: 'btn small', type: 'button', 'aria-label': `Stop allowing ${tool}: ${what}`, onclick: () => {
        setOption('allow', S.state.allow.filter(r => r !== rule));
        render();
        (list.querySelector('.mrule .btn') || search).focus();
      } }, 'Remove'));
  };
  const list = h('div', { class: 'mlist' });
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Search modes and rules', 'aria-label': 'Search modes and rules', autocomplete: 'off', oninput: () => render(),
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); list.querySelector('.mrow')?.click(); } } });
  const render = () => {
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = text => terms.every(t => text.toLowerCase().includes(t));
    const found = MODES.filter(m => hit(`${m.label} ${m.id} ${m.group} ${m.about} ${m.words}`));
    const auto = hit('autopilot hands off away unattended');
    const rules = (S.state.allow || []).filter(rule => hit(`always allowed ${ruleParts(rule).join(' ')}`));
    const groups = [...new Set(MODES.map(m => m.group))].flatMap(group => {
      const rows = found.filter(m => m.group === group).map(row);
      if (group === 'Hands off' && auto) rows.push(autoRow());
      return rows.length ? [h('h3', {}, group), ...rows] : [];
    });
    list.replaceChildren(...groups, ...(rules.length ? [h('h3', {}, 'Always allowed in this chat'), ...rules.map(ruleRow)] : []));
    if (!list.children.length) list.append(h('p', { class: 'mnone muted' }, `Nothing matches "${search.value}".`));
  };
  const d = h('dialog', { class: 'picker modes', 'aria-label': 'Choose permission mode',
    onclick: e => { if (e.target === d) shut(); },
    oncancel: e => { e.preventDefault(); shut(); },
    onclose: () => d.remove(),
    onkeydown: e => {
      if (/^[1-5]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); pick(MODES[e.key - 1].id); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const rows = [search, ...list.querySelectorAll('button')];
      rows[(rows.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length].focus();
    } },
    h('div', { class: 'mhead' }, h('h2', {}, 'Permission mode'), h('button', { class: 'btn small', type: 'button', onclick: shut }, 'Done')),
    search, list, h('div', { class: 'mfoot mhint muted' }, 'Shift+Tab switches the first three · 1–5 picks'));
  render();
  document.body.append(d);
  d.showModal();
  if (!touch.matches) search.focus();
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
    onchange: () => { if (!budget.validity.badInput) setOption('budget', Math.max(0, Number(budget.value) || 0)); } });
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
  syncQuality?.();
  if (!$input?.isConnected) return;
  const quality = st && qualityPresets().find(p => p.id === (st.quality || 'personal'));
  $qualityBtn.disabled = !quality;
  $qualityLabel.textContent = quality?.label || (st ? 'Unavailable' : 'Loading…');
  $qualityBtn.title = $qualityBtn.ariaLabel = quality ? `Build quality: ${quality.label} · ${quality.subtitle}. Planning and checks only; permissions unchanged.`
    : st ? 'Build quality is unavailable. Reconnect after the server finishes loading or updating.' : 'Build quality is loading';
  if (!st) return;
  $mode.value = st.mode;
  $mode.className = st.mode;
  const mode = MODES.find(m => m.id === st.mode);
  $modeLabel.textContent = mode?.label || st.mode;
  $input.placeholder = st.running ? 'Queue a message…' : 'Message Nexus';
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
  $sendBtn.textContent = $sendBtn.ariaLabel = $sendBtn.title = st.running ? 'Queue' : 'Send';
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
const AGENT_SCOPE = { nexus: 'Official', user: 'All projects', project: 'This project' };
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
        h('span', { class: 'mname' }, def ? def.name : 'Nexus', !def && h('span', { class: 'mtag' }, 'Default'), def && h('span', { class: `mtag${def.scope === 'nexus' ? '' : ' dim'}` }, AGENT_SCOPE[def.scope])),
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

// /create-agent and /create-skill run as normal prompts, so the agent can read the project and its file writes are shown for approval.
function createWithAI(about = '', cmd = 'create-agent') {
  const project = projectForInstall();
  if (!project) return toast('Create a project first.');
  drafts[project] = `/${cmd} ${about}`;
  if (S.project !== project || S.page || S.tab !== 'chat') go(project, null, 'chat');
  else if ($input?.isConnected) { $input.value = drafts[project]; grow(); }
  $input?.focus();
  toast(`Say what the ${cmd === 'create-skill' ? 'skill' : 'agent'} should do after /${cmd}, then send.`);
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

// Skills have no Nexus picks; their first source is Anthropic's own collection.
const firstSource = k => (k === 'skills' ? ['anthropic', 'Anthropic'] : ['nexus', 'Nexus picks']);
function marketPage(hamb) {
  let kind = S.marketKind || 'agents', source = S.marketSource || firstSource(kind)[0], items = [], category = '', picked = '', seq = 0, openSeq = 0, timer;
  const srcs = {};
  S.marketSource = null;
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
  const placeholder = () => detail.replaceChildren(h('p', { class: 'mnone muted' }, kind === 'mcp' ? 'Pick a server to see what it does and add it.'
    : kind === 'skills' ? 'Pick a skill to see what it does and install it. A GitHub link to any skill, pasted into the search box, works too.' : 'Pick an agent to see what it does and install it.'),
    ...(kind === 'skills' ? [h('div', { class: 'acts mnone' }, h('button', { class: 'btn', type: 'button', onclick: () => createWithAI('', 'create-skill') }, icon('spark'), 'Write a skill with AI'))] : []));
  const tab = (on, label, click) => h('button', { type: 'button', role: 'tab', class: on ? 'on' : '', 'aria-selected': String(on), onclick: click }, label);
  const renderTabs = () => {
    kinds.replaceChildren(...[['agents', 'Agents'], ['mcp', 'MCP servers'], ['skills', 'Skills']].map(([k, label]) => tab(k === kind, label, () => {
      if (k !== kind) { kind = S.marketKind = k; source = firstSource(k)[0]; category = ''; back(); placeholder(); load(); }
    })));
    search.placeholder = kind === 'skills' ? 'Search, or paste a GitHub link' : 'Search';
    sources.replaceChildren(...[...srcs[kind] || [firstSource(kind)], ['installed', 'Installed']].map(([id, label]) => tab(id === source, label, () => {
      if (id !== source) { source = id; category = ''; if (/github\.com\//.test(search.value)) search.value = ''; load(); } // a link means one repo, not a filter
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
  // A collection is a GitHub repo of skills: picking it lists them, the same as pasting its link.
  const pick = it => (it.collection ? (search.value = it.url, load()) : open(it));
  const tile = it => h('div', { class: `tile${`${source}:${it.id}` === picked ? ' on' : ''}`, 'data-key': `${source}:${it.id}` },
    h('button', { class: 'tmain', type: 'button', onclick: () => pick(it) },
      h('span', { class: 'ticon', 'aria-hidden': 'true' }, it.icon || (it.name[0] || '?').toUpperCase()),
      h('span', { class: 'ttext' },
        h('span', { class: 'tname' }, h('b', {}, it.name), it.featured && h('span', { class: 'mtag' }, 'Featured'), it.running === false && h('span', { class: 'mtag old' }, 'Asleep')),
        h('span', { class: 'tmeta' }, [it.author && `by ${it.author}`, it.category, it.stats].filter(Boolean).join(' · ')),
        h('span', { class: 'tdesc' }, it.description || 'No description.'))),
    h('button', { class: `btn small${it.installable ? ' primary' : ''}`, type: 'button', onclick: () => pick(it) }, source === 'installed' ? 'Manage' : it.collection ? 'Browse' : it.installable ? 'Install' : 'View'));
  async function load() {
    const mine = ++seq;
    renderTabs();
    grid.replaceChildren(h('p', { class: 'mnone muted' }, 'Loading…'));
    try {
      const q = search.value.trim();
      const res = source === 'installed' ? { items: await installedItems(kind, q) } : await api('GET', `/api/market?kind=${kind}&source=${source}&q=${encodeURIComponent(q)}&project=${encodeURIComponent(projectForInstall() || '')}`);
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
      const parts = src === 'installed' ? await installedDetail(it, k, back, load)
        : marketDetail({ ...it, ...await api('GET', `/api/market/item?kind=${k}&source=${src}&id=${encodeURIComponent(it.id)}&project=${encodeURIComponent(projectForInstall() || '')}`) }, k, back);
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
  if (kind === 'skills') {
    const project = projectForInstall();
    const { skills } = project ? await api('GET', `${P(project)}/meta`) : { skills: [] };
    const where = { user: 'All projects', project: 'This project', nexus: 'Comes with Nexus', other: 'From another tool' };
    return skills.map(k => ({ id: k.name, name: k.name, description: `${k.off ? 'Off · ' : ''}${k.description}`, category: where[k.scope], skill: k })).filter(match);
  }
  if (kind === 'mcp') {
    const { mcp } = await api('GET', '/api/settings');
    return mcp.map(s => ({ id: s.name, name: s.name, description: s.error || `${s.remote ? 'Remote · ' : ''}${s.status} · ${s.tools.length} tools`, server: s })).filter(match);
  }
  const project = projectForInstall();
  const { agents } = project ? await api('GET', `${P(project)}/meta`) : { agents: [] };
  return agents.filter(a => !a.builtin).map(a => ({ id: a.name, name: a.name, description: a.description, category: AGENT_SCOPE[a.scope], def: a })).filter(match);
}

async function installedDetail(it, kind, back, reload) {
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
  if (kind === 'skills') {
    const project = projectForInstall(), k = it.skill, url = `${P(project)}/skills/${encodeURIComponent(it.name)}`;
    const { body, source } = await api('GET', url);
    const mine = ['user', 'project'].includes(k.scope);
    const done = async msg => { if (S.project === project) await loadMeta(); toast(msg); back(); reload(); };
    const toggle = guard(async () => { await api('PUT', `/api/skills/${encodeURIComponent(it.name)}`, { off: !k.off }); await done(k.off ? `${it.name} is on again.` : `${it.name} is off in every project. Turn it on here any time.`); });
    const update = guard(async () => { await api('POST', `${P(project)}/skills`, { ...source, scope: k.scope }); await done(`Updated ${it.name} from GitHub.`); });
    return [...head, h('p', { class: 'small muted' }, k.off ? 'Off: Nexus doesn\'t offer it to the AI or as a command.' : `Type /${it.name} to use it, or just ask: Nexus reads it when a task fits.`),
      mine && source && h('div', { class: 'mlinks small' }, extLink(`From github.com/${source.repo}${source.dir ? `/${source.dir}` : ''}`, `https://github.com/${source.repo}/tree/HEAD/${source.dir}`)),
      h('details', { class: 'fold' }, h('summary', {}, 'Read SKILL.md', icon('down')), h('div', { class: 'out' }, body)),
      h('div', { class: 'acts' },
        h('button', { class: 'btn', type: 'button', onclick: toggle }, k.off ? 'Turn on' : 'Turn off'),
        mine && source && h('button', { class: 'btn', type: 'button', onclick: update }, 'Update'),
        mine && remove('Its folder is deleted. You can install it again from the marketplace.', async () => {
          await api('DELETE', url);
          if (S.project === project) await loadMeta();
        }))];
  }
  if (kind === 'mcp') {
    return [...head, h('div', { class: 'small muted' }, `Tools: ${it.server.tools.join(', ') || 'none yet'}`),
      h('div', { class: 'acts' }, remove('Its tools disappear from new messages. You can add it again from the marketplace.', () => api('DELETE', `/api/mcp-servers/${encodeURIComponent(it.name)}`)))];
  }
  const d = it.def, project = projectForInstall();
  const use = () => { setOption('agent', d.name); toast(`This chat now works as ${d.name}.`); };
  return [...head, h('div', { class: 'small muted' }, `Tools: ${d.tools?.join(', ') || 'every tool'}${d.model ? ` · ${d.model}` : ''}`),
    h('details', { class: 'fold' }, h('summary', {}, 'Read its instructions', icon('down')), h('div', { class: 'out' }, d.prompt)),
    h('div', { class: 'acts' },
      d.scope !== 'nexus' && remove('This removes the agent type from Nexus folders. Types in other folders stay.', () => api('DELETE', `${P(project)}/agent-defs/${encodeURIComponent(d.name)}`)),
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
  if (kind === 'skills') {
    const project = projectForInstall();
    if (!project) return [...parts, h('p', { class: 'err' }, 'Create a project first.')];
    const sid = uid();
    const scope = h('select', { class: 'field', id: sid }, h('option', { value: 'user' }, 'All projects'), h('option', { value: 'project' }, `This project (${pretty(project)})`));
    return [...parts,
      h('details', { class: 'fold' }, h('summary', {}, `What it installs: ${it.files.length} file${it.files.length === 1 ? '' : 's'}, ${Math.max(1, Math.round(it.size / 1024))} KB`, icon('down')), h('div', { class: 'out' }, it.files.join('\n'))),
      it.installable ? [h('div', {}, h('label', { class: 'lbl', htmlFor: sid }, 'Install for'), scope), err,
        h('div', { class: 'acts' }, h('button', { class: 'btn primary', type: 'button', onclick: e => busy(e.currentTarget, async () => {
          if (S.project === project && S.meta.skills.some(k => k.name === it.name) && !await confirmBox(`Replace ${it.name}?`, 'A skill with this name is already installed.', 'Replace', 'danger')) return;
          const { name } = await api('POST', `${P(project)}/skills`, { ...it.skill, scope: scope.value });
          if (S.project === project) await loadMeta();
          toast(`Installed ${name}. Type /${name} to use it, or just ask: Nexus reads it when a task fits.`);
          back();
        }) }, 'Install'))]
        : h('p', { class: 'err' }, 'Too big to install from here (over 200 files or 10 MB). Clone it and copy the folder instead.')];
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
// The language highlight.js knows a file by: its extension, a few extra names, or its whole name (Makefile, Dockerfile).
const EXT_LANG = { mjs: 'javascript', cjs: 'javascript', htm: 'xml', vue: 'xml', svelte: 'xml', toml: 'ini', jsonc: 'json', gitignore: 'bash' };
const langOf = file => {
  const base = file.split(/[\\/]/).pop().toLowerCase(), ext = base.includes('.') ? base.split('.').pop() : base;
  return [EXT_LANG[ext], ext, base].find(l => l && hljs.getLanguage(l)) || null;
};
// Big files are colored by a worker, since highlighting takes about a millisecond per KB and would stall typing.
const SMALL = 30_000;
let hlWorker = null, hlSeq = 0;
const highlightAway = (text, lang) => new Promise(resolve => {
  hlWorker ||= new Worker('/hljs-worker.js');
  const id = ++hlSeq;
  const done = e => { if (e.data.id === id) { hlWorker.removeEventListener('message', done); resolve(e.data.html); } };
  hlWorker.addEventListener('message', done);
  hlWorker.postMessage({ id, text, lang });
});
// The Files tab looks again at its tree and open file whenever they may have changed:
// after each tool call, at the end of a turn, and when you come back to the page from another app.
let filesWatch = null, watchTimer = 0;
const filesChanged = () => { clearTimeout(watchTimer); watchTimer = setTimeout(() => filesWatch?.(), 300); };
addEventListener('focus', filesChanged);
document.addEventListener('visibilitychange', () => { if (!document.hidden) filesChanged(); });

let pendingOpen = null, current = null;
function filesView(view) {
  current = null;
  const expanded = new Set();
  let loaded = '', disk = ''; // the open file as last loaded or saved, and the newest version seen on disk
  const tree = h('div', { class: 'tree', 'aria-label': 'Project files' });
  const pathEl = h('span', { class: 'path muted' }, 'Select a file');
  const langEl = h('span', { class: 'small muted' });
  // Code shows in color with line numbers: the textarea you type in is see-through, over a highlighted copy of its text,
  // so typing, undo, selection and phone keyboards all stay the browser's own.
  const code = h('code', { class: 'hljs' }), nums = h('div', { class: 'nums' });
  const layer = h('pre', { class: 'hl', 'aria-hidden': 'true' }, code);
  let lines = 0, frame = 0, slow = 0;
  const sync = () => {
    layer.style.transform = `translate(${-area.scrollLeft}px, ${-area.scrollTop}px)`;
    nums.style.transform = `translateY(${-area.scrollTop}px)`;
  };
  // wait: how long a big file's colors hold off, so they come once typing pauses rather than on every key.
  const paint = (wait = 600) => {
    frame = 0;
    clearTimeout(slow);
    const text = area.value, file = current, lang = file ? langOf(file) : null;
    // The copy ends with a newline so a last empty line takes up room, as it does in the textarea.
    if (lang && text.length < SMALL) code.innerHTML = `${hljs.highlight(text, { language: lang, ignoreIllegals: true }).value}\n`;
    else {
      code.textContent = `${text}\n`;
      if (lang) slow = setTimeout(async () => { const html = await highlightAway(text, lang); if (area.value === text && current === file) code.innerHTML = `${html}\n`; }, wait);
    }
    langEl.textContent = lang ? hljs.getLanguage(lang).name : '';
    const n = text.split('\n').length;
    if (n !== lines) { lines = n; nums.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); }
    sync();
  };
  const changed = () => { saveBtn.disabled = false; frame ||= requestAnimationFrame(() => paint()); };
  // New text from disk, keeping your place in the file.
  const setText = text => {
    const { scrollTop, scrollLeft, selectionStart, selectionEnd } = area;
    area.value = loaded = disk = text;
    area.setSelectionRange(Math.min(selectionStart, text.length), Math.min(selectionEnd, text.length));
    saveBtn.disabled = true;
    banner.hidden = true;
    paint(0);
    area.scrollTop = scrollTop;
    area.scrollLeft = scrollLeft;
    sync();
  };
  const banner = h('div', { class: 'ondisk', hidden: true, role: 'status' }, h('span', { class: 'grow' }, 'This file changed on disk while you were editing it.'),
    h('button', { class: 'btn small', type: 'button', onclick: () => setText(disk) }, 'Load the new version'),
    h('button', { class: 'btn small', type: 'button', onclick: () => { loaded = disk; banner.hidden = true; } }, 'Keep mine'));
  const area = h('textarea', { spellcheck: false, autocapitalize: 'off', autocomplete: 'off', disabled: true, 'aria-label': 'File contents', wrap: 'off', oninput: changed, onscroll: sync,
    onkeydown: e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end'); changed(); }
    } });
  const saveBtn = h('button', { class: 'btn small primary', disabled: true, onclick: () => save() }, 'Save');
  const save = guard(async () => {
    if (!current) return;
    await api('PUT', `${P(S.project)}/file`, { path: current, content: area.value });
    loaded = disk = area.value;
    saveBtn.disabled = true;
    banner.hidden = true;
    toast('Saved.');
  });
  const newBtn = h('button', { class: 'btn small', onclick: () => newFile(open) }, 'New file');
  // Hands the open file, and the selected lines if any, to the chat as an @ mention.
  const askBtn = h('button', { class: 'btn small', disabled: true, title: 'Ask about this file, or about the selected lines', onclick: guard(async () => {
    if (!saveBtn.disabled && !await confirmBox('Discard unsaved changes?', `${current} has changes that aren't saved. Save first if you want to ask about them.`, 'Discard', 'danger')) return;
    const line = i => area.value.slice(0, i).split('\n').length;
    const [a, b] = [line(area.selectionStart), line(Math.max(area.selectionStart, area.selectionEnd - 1))];
    const ref = `@${current}${area.selectionEnd > area.selectionStart ? (a === b ? ` line ${a}` : ` lines ${a}-${b}`) : ''} `;
    drafts[S.project] = `${(drafts[S.project] || '').trimEnd()} ${ref}`.trimStart();
    go(S.project, null, 'chat');
    $input.focus();
    $input.setSelectionRange($input.value.length, $input.value.length);
  }) }, 'Ask Nexus');
  const open = guard(async rel => {
    if (!saveBtn.disabled && !await confirmBox('Discard unsaved changes?', `${current} has changes that aren't saved.`, 'Discard', 'danger')) return;
    try {
      area.value = (await api('GET', `${P(S.project)}/file?path=${encodeURIComponent(rel)}`)).content;
    } catch (e) {
      // A missing file opens empty, ready to be created on save.
      if (!/no such file/i.test(e.message)) throw e;
      area.value = '';
    }
    area.disabled = false;
    loaded = disk = area.value;
    banner.hidden = true;
    current = rel; pathEl.textContent = rel; pathEl.classList.remove('muted'); saveBtn.disabled = true; askBtn.disabled = false;
    paint(0);
    area.scrollTop = area.scrollLeft = 0;
    sync();
    tree.querySelectorAll('.on').forEach(b => b.classList.remove('on'));
    tree.querySelector(`[data-path="${CSS.escape(rel)}"]`)?.classList.add('on');
  });
  // A folder in the tree. Folders you opened open again when the tree is listed anew.
  const branch = (full, label, title) => {
    const sub = h('ul', { hidden: true });
    const btn = h('button', { class: 'd', title, 'aria-expanded': 'false', onclick: guard(async () => {
      sub.hidden = !sub.hidden;
      btn.setAttribute('aria-expanded', String(!sub.hidden));
      if (sub.hidden) expanded.delete(full);
      else { expanded.add(full); await list(full, sub); }
    }) }, label);
    btn.dataset.path = full;
    const reopen = () => expanded.has(full) && (sub.hidden = false, btn.setAttribute('aria-expanded', 'true'), list(full, sub));
    return [h('li', {}, btn, sub), reopen];
  };
  async function list(rel, into) {
    // Asked of the server, since a page opened straight on this tab may not have the chat's state yet.
    const [items, dirs] = await Promise.all([api('GET', `${P(S.project)}/tree?path=${encodeURIComponent(rel)}`), rel === '.' ? api('GET', `${P(S.project)}/folders`).then(r => r.dirs) : []]);
    if (rel === '.' && !items.length && !dirs.length) { into.replaceChildren(h('li', { class: 'muted', style: 'padding:4px 6px' }, 'Empty folder')); return; }
    const sep = /^[a-zA-Z]:\\|^\\\\/.test(rel) ? '\\' : '/'; // a Windows path in an added folder keeps its own separator
    const reopen = [];
    const folder = (...args) => { const [li, again] = branch(...args); reopen.push(again); return li; };
    into.replaceChildren(...items.map(it => {
      const full = rel === '.' ? it.name : `${rel}${sep}${it.name}`;
      if (it.dir) return folder(full, `${it.name}/`);
      const btn = h('button', { class: full === current ? 'on' : '', onclick: () => open(full) }, it.name);
      btn.dataset.path = full;
      return h('li', {}, btn);
    }), ...dirs.map(d => folder(d, `${d.split(/[\\/]/).pop()}/ (added)`, d)));
    await Promise.all(reopen.map(again => again()));
  }
  const root = h('ul');
  tree.append(root);
  view.append(h('div', { class: 'files' }, tree, h('div', { class: 'editor' }, h('div', { class: 'ebar' }, pathEl, langEl, askBtn, newBtn, saveBtn), banner,
    h('div', { class: 'code' }, h('div', { class: 'gutter', 'aria-hidden': 'true' }, nums), h('div', { class: 'pane' }, layer, area)))));
  filesWatch = guard(async () => {
    if (!view.isConnected) return;
    const top = tree.scrollTop;
    await list('.', root);
    tree.scrollTop = top;
    if (!current) return;
    const now = await api('GET', `${P(S.project)}/file?path=${encodeURIComponent(current)}`).then(r => r.content, () => null);
    if (now === null || now === disk || !view.isConnected) return; // gone or unreadable: the editor keeps what it has
    disk = now;
    if (now === loaded) banner.hidden = true;
    else if (saveBtn.disabled) setText(now);
    else banner.hidden = false;
  });
  guard(list)('.', root);
  if (pendingOpen) { open(pendingOpen); pendingOpen = null; }
}
function newFile(open) {
  const input = h('input', { class: 'field mono', id: 'nf', placeholder: 'src/index.js', spellcheck: false, autocapitalize: 'off' });
  dialog({ title: 'New file', body: h('div', {}, h('label', { class: 'lbl', htmlFor: 'nf' }, 'Path in this project'), input),
    actions: [{ label: 'Cancel' }, { label: 'Open', class: 'primary', run: () => { if (input.value.trim()) open(input.value.trim()); } }] });
}

// ---- changes ----
const diffLine = l => {
  const cls = /^(\+\+\+|---|diff )/.test(l) ? 'head' : l.startsWith('@@') ? 'hunk' : l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : '';
  return cls ? h('span', { class: cls }, l) : `${l}\n`;
};
// One entry per file: its path as Undo file takes it, its lines, and how many were added and removed.
function splitDiff(diff) {
  const files = [];
  for (const l of diff.split('\n')) {
    const file = /^diff --git a\/(.+) b\/\1$/.exec(l)?.[1];
    if (file) { files.push({ path: file, lines: [], add: 0, del: 0 }); continue; }
    const f = files.at(-1);
    if (!f) continue;
    f.lines.push(l);
    if (l[0] === '+' && !l.startsWith('+++')) f.add++;
    else if (l[0] === '-' && !l.startsWith('---')) f.del++;
  }
  return files;
}

// Like VS Code's Keep and Undo: after a turn, the files it changed wait above the message box until each is kept or undone.
// Sending the next message keeps whatever is left, since changes are counted from your last prompt.
let $review = null;
async function refreshReview() {
  const box = $review, project = S.project;
  if (!box?.isConnected) return;
  const ch = S.state && !S.state.running ? await api('GET', `${P(project)}/changes`).catch(() => null) : null;
  if (box !== $review || project !== S.project || S.state?.running) return;
  const files = ch?.id ? splitDiff(ch.diff).filter(f => !ch.kept.includes(f.path)) : [];
  box.hidden = !files.length;
  if (!files.length) return;
  const after = fn => guard(async () => { await fn(); await refreshReview(); });
  const keep = paths => after(() => api('POST', `${P(project)}/changes/keep`, { files: paths }));
  const undo = paths => after(async () => { for (const path of paths) await api('POST', `${P(project)}/changes/undo`, { path }); });
  const undoAll = guard(async () => {
    if (!await confirmBox(`Undo ${files.length} file${files.length === 1 ? '' : 's'}?`, 'Each goes back to how it was before your last prompt, and files the AI created are deleted. Files you kept stay as they are.', 'Undo all', 'danger')) return;
    await undo(files.map(f => f.path))();
  });
  box.replaceChildren(
    h('div', { class: 'rrow rhead' }, h('b', { class: 'grow' }, `${files.length} file${files.length === 1 ? '' : 's'} changed`),
      h('button', { class: 'btn small', type: 'button', onclick: keep(files.map(f => f.path)) }, icon('check'), 'Keep all'),
      h('button', { class: 'btn small', type: 'button', onclick: undoAll }, icon('undo'), 'Undo all')),
    ...files.map(f => {
      const pre = h('pre', { class: 'diff', hidden: true }, f.lines.filter(l => !/^(index |--- |\+\+\+ |(new|deleted) file mode)/.test(l)).map(diffLine));
      // A file in an added folder is shown from that folder's name, like api/src/app.js; the tooltip has the full path.
      const root = (S.state?.dirs || []).map(d => d.split(/[\\/]/).join('/')).find(d => f.path.startsWith(`${d}/`));
      const parts = (root ? `${root.split('/').pop()}${f.path.slice(root.length)}` : f.path).split('/');
      return h('div', { class: 'rfile' },
        h('div', { class: 'rrow' },
          h('button', { class: 'linkbtn rname', type: 'button', title: f.path, 'aria-expanded': 'false', onclick: e => { pre.hidden = !pre.hidden; e.currentTarget.setAttribute('aria-expanded', String(!pre.hidden)); } },
            h('span', { class: 'mono' }, parts.pop()), parts.length ? h('span', { class: 'small muted' }, ` ${parts.join('/')}`) : null),
          h('span', { class: 'small radd' }, `+${f.add}`), h('span', { class: 'small rdel' }, `-${f.del}`),
          h('button', { class: 'btn small', type: 'button', 'aria-label': `Keep ${f.path}`, onclick: keep([f.path]) }, 'Keep'),
          h('button', { class: 'btn small', type: 'button', 'aria-label': `Undo ${f.path}`, onclick: undo([f.path]) }, 'Undo')),
        pre);
    }));
}

function changesView(view) {
  const box = h('pre', { class: 'diff', tabIndex: 0, 'aria-label': 'Changes' }, 'Loading…');
  const since = h('span', { class: 'path muted' });
  view.append(h('div', { class: 'ebar' }, since, h('button', { class: 'btn small', onclick: () => gitDialog(load) }, 'Source control'), h('button', { class: 'btn small', onclick: load }, 'Refresh')), box);
  async function load() {
    try {
      const { since: s, diff } = await api('GET', `${P(S.project)}/changes`);
      since.textContent = s ? `Since your last prompt: ${s}` : 'No checkpoint yet. Send a prompt first.';
      box.replaceChildren(...(diff ? diff.split('\n').map(l => {
        const file = /^diff --git a\/(.+) b\/\1$/.exec(l)?.[1];
        if (file) return h('span', { class: 'head' }, l, h('button', { class: 'btn small undo', type: 'button', onclick: guard(async () => {
          if (!await confirmBox(`Undo ${file}?`, 'It goes back to how it was before your last prompt, or is deleted if the AI created it.', 'Undo file', 'danger')) return;
          await api('POST', `${P(S.project)}/changes/undo`, { path: file });
          load();
        }) }, 'Undo file'));
        return diffLine(l);
      }) : ['No file changes.']));
    } catch (e) { box.textContent = e.message; }
  }
  load();
}

// Source control: the folder's git status, a commit with a message the AI can write, branches, history, pull and push.
const GIT_STATUS = { M: 'changed', A: 'added', D: 'deleted', R: 'renamed', '??': 'new', '?': 'new', U: 'conflict' };
const gitDialog = guard(async after => {
  const project = S.project, body = h('div', { class: 'form' });
  const render = async () => {
    const g = await api('GET', `${P(project)}/git`);
    if (!g.repo) return body.replaceChildren(h('p', {}, "This folder isn't a git repository yet. Ask Nexus to run git init, or open a cloned repo."));
    const act = (action, extra = {}, done) => guard(async e => {
      e.currentTarget.disabled = true;
      try { await api('POST', `${P(project)}/git`, { action, ...extra }); toast(done); await render(); after?.(); } finally { e.currentTarget.disabled = false; }
    });
    const msg = h('textarea', { class: 'field', id: 'gmsg', rows: 3, placeholder: 'What changed and why' });
    const write = guard(async e => { const b = e.currentTarget; b.disabled = true; try { msg.value = (await api('POST', `${P(project)}/git/message`, {})).message; } finally { b.disabled = false; } });
    const pick = h('select', { class: 'field', 'aria-label': 'Branch' }, g.branches.map(b => h('option', { value: b, selected: b === g.branch }, b)));
    const fresh = h('input', { class: 'field', placeholder: 'new-branch-name', 'aria-label': 'New branch name', spellcheck: false, autocapitalize: 'off' });
    const history = g.log.map(c => {
      const d = h('details', { class: 'fold' }, h('summary', {}, h('span', { class: 'mono muted' }, c.hash), ' ', c.subject, h('span', { class: 'small muted' }, ` · ${c.author}, ${c.when}`)));
      d.addEventListener('toggle', guard(async () => {
        if (!d.open || d.querySelector('pre')) return;
        const { text } = await api('GET', `${P(project)}/git/show?hash=${c.hash}`);
        d.append(h('pre', { class: 'diff' }, text.split('\n').map(diffLine)));
      }));
      return d;
    });
    body.replaceChildren(...[
      h('div', { class: 'rowline' }, h('div', { class: 'grow' }, h('span', { class: 'title' }, `On ${g.branch || 'no branch'}`),
        h('span', { class: 'small muted' }, g.upstream ? ` · ${g.ahead} to push, ${g.behind} to pull` : ' · not on GitHub or another remote yet')),
        g.upstream && h('button', { class: 'btn small', type: 'button', onclick: act('pull', {}, 'Pulled.') }, 'Pull'),
        h('button', { class: 'btn small', type: 'button', onclick: act('push', {}, 'Pushed.') }, 'Push')),
      h('div', { class: 'title' }, g.files.length ? `${g.files.length} changed file${g.files.length === 1 ? '' : 's'}` : 'Nothing to commit'),
      g.files.length > 0 && h('div', { class: 'out gfiles' }, g.files.slice(0, 300).map(f => h('div', {}, h('span', { class: 'muted' }, `${GIT_STATUS[f.status] || GIT_STATUS[f.status[0]] || f.status} `), f.path))),
      g.files.length > 0 && h('div', {}, h('label', { class: 'lbl', htmlFor: 'gmsg' }, 'Commit message'), msg,
        h('div', { class: 'rowline', style: 'margin-top:6px' }, h('button', { class: 'btn', type: 'button', onclick: write }, icon('spark'), 'Write it with AI'),
          h('button', { class: 'btn primary', type: 'button', onclick: e => act('commit', { message: msg.value }, 'Committed.')(e) }, 'Commit all'))),
      h('div', { class: 'title' }, 'Branches'),
      h('div', { class: 'rowline' }, pick, h('button', { class: 'btn', type: 'button', onclick: e => act('switch', { branch: pick.value }, `On ${pick.value} now.`)(e) }, 'Switch'),
        fresh, h('button', { class: 'btn', type: 'button', onclick: e => act('create', { branch: fresh.value }, `Made ${fresh.value} and switched to it.`)(e) }, 'New branch')),
      h('div', { class: 'title' }, 'History'),
      history.length ? h('div', { class: 'ghist' }, history) : h('p', { class: 'small muted' }, 'No commits yet.')].filter(Boolean));
  };
  await render();
  dialog({ title: 'Source control', wide: true, body, actions: [{ label: 'Close' }] });
});

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
    const current = termState;
    requestAnimationFrame(() => {
      if (!current.el.isConnected) return;
      current.fit();
      if (!document.activeElement?.closest('.tabs')) current.term.focus();
    });
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
      : h('p', { class: 'muted' }, 'Nothing scheduled. In a chat, /schedule 0 9 * * 1-5 /review branch reviews that branch every weekday at 9.'),
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
        h('div', { class: 'small muted' }, `${d.builtin ? 'Built in' : AGENT_SCOPE[d.scope] || d.scope} · tools: ${d.tools?.join(', ') || 'all'}${d.model ? ` · ${d.model}` : ''}`)),
      !d.builtin && h('button', { class: 'btn small', onclick: () => editDef(project, d) }, 'Edit'),
      !d.builtin && d.scope !== 'nexus' && h('button', { class: 'btn small danger', 'aria-label': `Delete ${d.name}`, onclick: guard(async () => {
        if (await confirmBox(`Delete ${d.name}?`, 'This removes the agent type from Nexus folders. Types in other folders stay.', 'Delete', 'danger')) { await api('DELETE', `${P(project)}/agent-defs/${encodeURIComponent(d.name)}`); refreshAgentsSoon(); }
      }) }, 'Delete'))),
    h('div', { class: 'rowline', style: 'margin:22px auto 10px' }, h('h2', { style: 'margin:0', class: 'grow' }, `Skills (${meta.skills.length})`),
      project && h('button', { class: 'btn small', onclick: () => createWithAI('', 'create-skill') }, icon('spark'), 'Create with AI'),
      h('button', { class: 'btn small primary', onclick: () => { S.marketSource = 'installed'; openMarket('skills'); } }, icon('grid'), 'Manage')),
    meta.skills.map(k => h('div', { class: 'card' }, h('div', { class: 'title mono' }, k.name), h('div', { class: 'small muted' }, `${k.off ? 'Off · ' : ''}${k.description}`))),
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
    await modelsCard(),
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
    await spendCard(),
    autopilotCard(area),
    riskCard(area),
    reliabilityCard(area),
    typeCheckCard(area),
    githubCard(area),
    sandboxCard(area),
    permissionsCard(area, mcp),
    h('h2', {}, h('label', { htmlFor: 'set' }, '~/.nexus/settings.json')),
    h('p', { class: 'small muted' }, 'Hooks run on PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStop, PreCompact and Notification; a hook exiting with 2 blocks a tool call or prompt. MCP servers reconnect within seconds of saving.'),
    h('p', { class: 'small muted' }, 'Models: add any other OpenAI-compatible server under "providers", as in the example.'),
    area, err,
    h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn primary', onclick: async () => {
      err.textContent = '';
      try { await api('PUT', '/api/settings', { text: area.value }); toast('Saved.'); } catch (e) { err.textContent = e.message; }
    } }, 'Save')),
    h('h2', {}, 'Example'),
    h('pre', { class: 'out' }, JSON.stringify({ autoCompactTokens: 300000, providers: { openrouter: { apiKey: 'sk-or-…' }, groq: { name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: 'gsk_…' } }, hooks: { PreToolUse: [{ matcher: 'Bash', command: 'jq -r .input.command >> ~/.nexus/bash.log' }] }, mcpServers: { memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] } } }, null, 2)),
  ].flat());
}

// Keys for the model providers, pasted here on a first run instead of into an environment file. The page only learns whether each is set.
const KEY_INFO = {
  ANTHROPIC_API_KEY: ['Anthropic', 'anthropic', 'Claude models', 'https://console.anthropic.com/settings/keys'],
  OPENAI_API_KEY: ['OpenAI', 'openai', 'GPT models', 'https://platform.openai.com/api-keys'],
  OPENROUTER_API_KEY: ['OpenRouter', 'openrouter', 'Hundreds of models from every lab, some free', 'https://openrouter.ai/keys'],
  GEMINI_API_KEY: ['Google Gemini', 'gemini', 'Gemini models, with a free tier', 'https://aistudio.google.com/apikey'],
  GROQ_API_KEY: ['Groq', 'groq', 'Fast open models', 'https://console.groq.com/keys'],
  DEEPSEEK_API_KEY: ['DeepSeek', 'deepseek', 'Low-cost DeepSeek models', 'https://platform.deepseek.com/api_keys'],
  MISTRAL_API_KEY: ['Mistral', 'mistral', 'Mistral and Codestral', 'https://console.mistral.ai/api-keys'],
  XAI_API_KEY: ['xAI', 'xai', 'Grok models', 'https://console.x.ai'],
  DASHSCOPE_API_KEY: ['Alibaba Qwen (DashScope)', 'dashscope', 'Qwen models, with a key from any region', 'https://www.alibabacloud.com/help/en/model-studio/get-api-key'],
};
async function modelsCard() {
  const [keys, details] = await Promise.all([guard(() => api('GET', '/api/keys'))(), guard(() => api('GET', '/api/models?details=1'))()]);
  if (!keys) return [];
  const { models, errors } = details || { models: [], errors: [] };
  S.models = models;
  const local = [...new Set(models.filter(m => /this computer/.test(m.providerName || '')).map(m => m.providerName.split(' · ')[0]))];
  const row = k => {
    const [label, provider, what, url] = KEY_INFO[k.name] || [k.name, '', '', ''];
    const n = models.filter(m => m.provider === provider).length, id = uid();
    const failure = errors.find(e => e.provider === provider)?.error;
    const input = h('input', { class: 'field', id, type: 'password', autocomplete: 'off', spellcheck: false, placeholder: k.saved ? 'Paste a new key to replace it' : 'Paste an API key' });
    const put = guard(async value => {
      await api('PUT', `/api/keys/${k.name}`, { value });
      const next = await api('GET', '/api/models?details=1');
      S.models = next.models;
      syncComposer();
      const got = S.models.filter(m => m.provider === provider).length, failed = next.errors.find(e => e.provider === provider);
      toast(!value ? `Removed the ${label} key.` : failed ? `Saved the ${label} key, but its model request failed.` : got ? `${label} is connected: ${got} models are in the model picker.` : `Saved the ${label} key, but it returned no compatible models.`);
      render();
      if (value && failed) throw Object.assign(new Error(failed.error), { provider: label });
    });
    const save = () => (input.value.trim() ? put(input.value.trim()) : toast('Paste a key first.'));
    const status = failure ? 'Could not load models' : n ? `Connected · ${n} models` : k.env || k.saved ? 'Key set, but no compatible models came back.' : 'Not set';
    return h('div', { class: 'keyrow' },
      h('div', { class: 'rowline' }, h('span', { class: `dot ${failure ? 'error' : n ? 'done' : k.env || k.saved ? 'error' : 'idle'}`, 'aria-hidden': 'true' }),
        h('div', { class: 'grow' }, h('label', { class: 'title', htmlFor: id }, label), h('div', { class: 'small muted' }, `${status} · ${what} · `, extLink('Get a key', url))),
        k.saved && !k.env && h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Remove the ${label} key`, onclick: () => put('') }, 'Remove')),
      k.env ? h('div', { class: 'small muted' }, `Set in Nexus's environment as ${k.name}.`)
        : h('div', { class: 'rowline' }, input, h('button', { class: 'btn', type: 'button', onclick: save }, 'Save')),
      failure && h('div', { class: 'out err', role: 'alert' }, failure));
  };
  const other = errors.filter(e => !keys.some(k => KEY_INFO[k.name]?.[1] === e.provider));
  return [h('h2', {}, 'Models'),
    h('p', { class: 'small muted' }, models.length ? '' : 'Add a key for at least one provider to start chatting. ',
      `Keys stay on this machine in ~/.nexus/keys.json, and the agent's shell commands never get them. Ollama and LM Studio models appear by themselves while they run on this computer${local.length ? ` (running now: ${local.join(', ')})` : ''}.`),
    h('div', { class: 'card' }, keys.map(row), other.length > 0 && h('details', { class: 'fold' },
      h('summary', {}, `Other and local provider diagnostics (${other.length})`), other.map(e => h('div', { class: 'out err' }, e.error))))];
}

async function spendCard() {
  const sp = await guard(() => api('GET', '/api/spending'))();
  if (!sp) return [];
  return [h('h2', {}, 'Spending'),
    h('div', { class: 'card' }, h('div', { class: 'title' }, `About ${usd(sp.total)} across all chats`),
      h('div', { class: 'small muted' }, `Estimated from list prices, like each chat's meter.${sp.unpriced ? ` Not counting ${sp.unpriced} requests to models with no known price.` : ''}`),
      sp.chats.map(c => h('div', { class: 'rowline spend' }, h('button', { class: 'linkbtn grow', type: 'button', onclick: () => go(c.name, null, 'chat') }, pretty(c.name)), h('span', { class: 'mono' }, usd(c.cost)))))];
}

// Writes some keys of settings.json (undefined removes one) through the same endpoint as the editor below, keeping the editor in step.
async function putSettings(area, patch) {
  const { text } = await api('GET', '/api/settings');
  const next = `${JSON.stringify({ ...JSON.parse(text), ...patch }, null, 2)}\n`;
  await api('PUT', '/api/settings', { text: next });
  if (area.value === text.replace(/\r\n?/g, '\n')) area.value = next;
  return JSON.parse(next);
}

// On by default; settings.json "riskCheck": false turns it off.
function riskCard(area) {
  const box = h('input', { type: 'checkbox', id: 'riskon', 'aria-describedby': 'riskon-hint' });
  guard(async () => { box.checked = JSON.parse((await api('GET', '/api/settings')).text).riskCheck !== false; })();
  box.onchange = guard(async () => {
    await putSettings(area, { riskCheck: box.checked ? undefined : false });
    toast(box.checked ? 'Risky calls are checked first again.' : 'The risk check is off.');
  });
  return [h('h2', {}, 'Risk check'),
    h('div', { class: 'card' }, h('label', { class: 'rowline', htmlFor: 'riskon' }, box, h('span', { class: 'grow' }, 'Check risky commands and edits with the AI before they run')),
      h('p', { class: 'small muted', id: 'riskon-hint' }, "Deleting folders, force-pushing, git resets, admin rights, deploys, database deletes and edits to secrets or CI files get a risk rating from the chat's model first. If it is high, the agent stops to look for a safer way. If there isn't one, you're asked, or on autopilot and in bypass it goes ahead. Each check is one short extra request, rarely needed."))];
}

function autopilotCard(area) {
  const input = h('input', { class: 'field', type: 'number', id: 'apreq', min: 0, step: 1, inputmode: 'numeric', 'aria-describedby': 'apreq-hint' });
  guard(async () => { input.value = JSON.parse((await api('GET', '/api/settings')).text).autopilotRequests ?? 150; })();
  const save = guard(async () => {
    const n = Number(input.value);
    if (input.value === '' || input.validity.badInput || !Number.isInteger(n) || n < 0) return toast('Use a whole number, or 0 for no limit.');
    await putSettings(area, { autopilotRequests: n });
    toast(n ? `Autopilot now pauses after ${n} requests until your next message.` : 'Autopilot has no request limit now. Only a budget stops it.');
  });
  return [h('h2', {}, h('label', { htmlFor: 'apreq' }, 'Autopilot request limit')),
    h('div', { class: 'card' }, h('div', { class: 'rowline' }, input, h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save')),
      h('p', { class: 'small muted', id: 'apreq-hint' }, 'How many model requests autopilot makes, subagents included, before it pauses until your next message. Long tasks may need 500 or more. 0 means no limit, so set a budget with /budget to cap the cost. Applies right away, even to a running chat.'))];
}

// Off by default; settings.json "sandbox": true and "sandboxNetwork": false.
function sandboxCard(area) {
  const box = h('input', { type: 'checkbox', id: 'sbox', 'aria-describedby': 'sbox-hint' });
  const net = h('input', { type: 'checkbox', id: 'snet' });
  const status = h('p', { class: 'small muted' });
  guard(async () => {
    const [sb, st] = await Promise.all([api('GET', '/api/sandbox'), api('GET', '/api/settings').then(r => JSON.parse(r.text))]);
    box.checked = sb.enabled; net.checked = st.sandboxNetwork === false;
    box.disabled = !sb.available && !sb.enabled; net.disabled = !sb.available;
    status.textContent = sb.available ? `This computer has ${sb.available}.` : sb.platform === 'win32' ? 'Not available on Windows yet: Nexus sandboxes commands on Linux and macOS.' : sb.platform === 'linux' ? 'Install bubblewrap (apt install bubblewrap) to use it.' : 'Not available on this system.';
  })();
  box.onchange = guard(async () => { await putSettings(area, { sandbox: box.checked || undefined }); toast(box.checked ? "The agent's commands now run in the sandbox." : 'The sandbox is off.'); });
  net.onchange = guard(async () => { await putSettings(area, { sandboxNetwork: net.checked ? false : undefined }); toast(net.checked ? 'Sandboxed commands have no network now.' : 'Sandboxed commands can use the network.'); });
  return [h('h2', {}, 'Sandbox'),
    h('div', { class: 'card' }, h('label', { class: 'rowline', htmlFor: 'sbox' }, box, h('span', { class: 'grow' }, "Run the agent's shell commands in a sandbox")),
      h('p', { class: 'small muted', id: 'sbox-hint' }, "They can only write inside the chat's folders, the temp folder and package caches, so a bad command in bypass or on autopilot can't change the rest of the computer. Your own commands (!cmd, /check) aren't sandboxed. Add more writable folders under \"sandboxWritable\" in settings.json."),
      h('label', { class: 'rowline', htmlFor: 'snet' }, net, h('span', { class: 'grow' }, 'No network for sandboxed commands')), status)];
}

// Off by default; settings.json "githubTriggers": true turns it on.
function githubCard(area) {
  const box = h('input', { type: 'checkbox', id: 'ghtrig', 'aria-describedby': 'ghtrig-hint' });
  const who = h('span', { class: 'small muted' });
  guard(async () => {
    const g = await api('GET', '/api/github');
    box.checked = g.enabled;
    who.textContent = g.login ? `gh is signed in as @${g.login}, so only @${g.login}'s comments count.` : 'The GitHub CLI (gh) is not signed in here. Install it and run gh auth login first.';
  })();
  box.onchange = guard(async () => {
    await putSettings(area, { githubTriggers: box.checked || undefined });
    toast(box.checked ? 'Write @nexus in a comment on an issue or pull request to start a chat. Nexus looks every two minutes.' : 'GitHub triggers are off.');
  });
  return [h('h2', {}, 'GitHub'),
    h('div', { class: 'card' }, h('label', { class: 'rowline', htmlFor: 'ghtrig' }, box, h('span', { class: 'grow' }, 'Start a chat when I write @nexus on an issue or pull request')),
      h('p', { class: 'small muted', id: 'ghtrig-hint' }, "Every two minutes Nexus checks the GitHub repositories of your projects for new comments of yours that mention @nexus, starts a chat in that project with the comment as the task, and posts the agent's summary back as a reply. Nobody else's comments count. The chat works in the project's usual mode, so it may wait for your approval. ", who))];
}

// On by default; settings.json "typeCheck": false turns it off.
function typeCheckCard(area) {
  const box = h('input', { type: 'checkbox', id: 'tcheck', 'aria-describedby': 'tcheck-hint' });
  guard(async () => { box.checked = JSON.parse((await api('GET', '/api/settings')).text).typeCheck !== false; })();
  box.onchange = guard(async () => {
    await putSettings(area, { typeCheck: box.checked ? undefined : false });
    toast(box.checked ? 'TypeScript projects are type checked after changes again.' : 'The type check after changes is off.');
  });
  const sug = h('input', { type: 'checkbox', id: 'sugon', 'aria-describedby': 'sugon-hint' });
  guard(async () => { sug.checked = JSON.parse((await api('GET', '/api/settings')).text).suggestReplies === true; })();
  sug.onchange = guard(async () => {
    await putSettings(area, { suggestReplies: sug.checked || undefined });
    toast(sug.checked ? 'Replies to tap now show after each answer.' : 'Suggested replies are off.');
  });
  const mem = h('input', { type: 'checkbox', id: 'memon', 'aria-describedby': 'memon-hint' });
  guard(async () => { mem.checked = JSON.parse((await api('GET', '/api/settings')).text).memory !== false; })();
  mem.onchange = guard(async () => {
    await putSettings(area, { memory: mem.checked ? undefined : false });
    toast(mem.checked ? 'Chats remember what they learn about each project again.' : 'Project memory is off. Saved notes stay, unused.');
  });
  return [h('h2', {}, 'Code checks'),
    h('div', { class: 'card' }, h('label', { class: 'rowline', htmlFor: 'tcheck' }, box, h('span', { class: 'grow' }, 'Type check TypeScript projects after the agent changes code')),
      h('p', { class: 'small muted', id: 'tcheck-hint' }, "After a turn that changed code in a project with a tsconfig.json and its own typescript, Nexus runs tsc and hands errors the change caused back to the agent, twice at most. A JavaScript, JSON or Python file that stops parsing is caught right after each edit, always. A /check command in a chat replaces the type check. With the sandbox on, the automatic compiler runs inside it too; if it cannot start, no successful check is shown.")),
    h('h2', {}, 'Project memory'),
    h('div', { class: 'card' }, h('label', { class: 'rowline', htmlFor: 'memon' }, mem, h('span', { class: 'grow' }, 'Let chats remember what they learn about each project')),
      h('p', { class: 'small muted', id: 'memon-hint' }, "The agent saves facts later chats need, like how to run the tests, and every chat in that project sees them as notes to check. Read or prune a project's notes from its menu → Memory. Keys and passwords are never kept.")),
    h('h2', {}, 'Composer'),
    h('div', { class: 'card' }, h('label', { class: 'rowline', htmlFor: 'sugon' }, sug, h('span', { class: 'grow' }, 'Suggest replies to tap after each answer')),
      h('p', { class: 'small muted', id: 'sugon-hint' }, 'Two or three short things you might say next, so on a phone you can tap instead of typing. Each costs one small extra request to the chat\'s model. The sparkle button by the message box rewrites a rough prompt into a clearer one, whatever this is set to.'))];
}

// All off by default: settings.json "requestsPerMinute", "autoRetry", "notifyErrors" and "fallbackModels". The server reads them on each request.
function reliabilityCard(area) {
  const card = h('div', { class: 'card form' });
  const render = st => {
    const rpm = h('input', { class: 'field grow', type: 'number', id: 'rpm', min: 0, step: 1, inputmode: 'numeric', value: st.requestsPerMinute || 0, 'aria-describedby': 'rpm-hint' });
    const saveRpm = guard(async () => {
      const n = Number(rpm.value);
      if (rpm.value === '' || rpm.validity.badInput || !Number.isInteger(n) || n < 0) return toast('Use a whole number, or 0 for no limit.');
      render(await putSettings(area, { requestsPerMinute: n || undefined }));
      toast(n ? `At most ${n} requests a minute now go to each provider.` : 'Requests are no longer paced.');
    });
    const flag = (key, label, hint, on, off) => {
      const box = h('input', { type: 'checkbox', id: `set-${key}`, checked: Boolean(st[key]), 'aria-describedby': `set-${key}-hint`, onchange: guard(async () => {
        render(await putSettings(area, { [key]: box.checked || undefined }));
        toast(box.checked ? on : off);
      }) });
      return [h('label', { class: 'rowline check', htmlFor: box.id }, box, h('span', { class: 'grow title' }, label)), h('p', { class: 'small muted', id: `${box.id}-hint` }, hint)];
    };
    const list = Array.isArray(st.fallbackModels) ? st.fallbackModels : [];
    const label = id => { const m = S.models?.find(x => x.id === id); return m ? `${m.name || m.id} · ${m.providerName || m.provider || ''}` : id; };
    const save = async next => render(await putSettings(area, { fallbackModels: next.length ? next : undefined }));
    const add = h('select', { class: 'field', id: 'fbadd', 'aria-describedby': 'fb-hint', onchange: guard(async () => { if (add.value) await save([...list, add.value]); }) },
      h('option', { value: '' }, list.length ? 'Add another model…' : 'Add a model…'), ...(S.models || []).filter(m => !list.includes(m.id)).map(m => h('option', { value: m.id }, label(m.id))));
    card.replaceChildren(...[
      h('label', { class: 'title', htmlFor: 'rpm' }, 'Requests per minute, to each provider'),
      h('div', { class: 'rowline' }, rpm, h('button', { class: 'btn', type: 'button', onclick: saveRpm }, 'Save')),
      h('p', { class: 'small muted', id: 'rpm-hint' }, "Paces requests so a provider's per-minute limit is never hit, counting every chat and subagent together. Set it a little under the limit your provider's console shows for your plan. 0 means no pacing."),
      ...flag('autoRetry', 'Retry automatically when a request fails', 'Rate limits, overloaded servers and dropped connections are tried again up to 6 times, waiting as long as the provider asks (up to 10 minutes each). The chat shows each wait, and Stop cancels it. A key out of credit is not retried.',
        'Failed requests are retried now.', 'Failed requests are no longer retried after the first few seconds.'),
      ...flag('notifyErrors', 'Notify me when a chat stops on an error', 'Send an OS or push notification when a chat fails, through the notifications you have turned on. Errors always stay visible in Nexus.',
        'Errors now come with a notification.', 'Error notifications are off.'),
      h('label', { class: 'title', htmlFor: 'fbadd' }, 'Fallback models'),
      h('p', { class: 'small muted', id: 'fb-hint' }, "When a key runs out of credit or quota, the chat switches to the first model below from a different provider and carries on. You'll see the switch in the chat. Empty means no switching."),
      list.length > 0 && h('ol', { class: 'fblist' }, list.map((id, i) => h('li', { class: 'rowline' }, h('span', { class: 'grow mono' }, label(id)),
        i > 0 && h('button', { class: 'btn small', type: 'button', 'aria-label': `Move ${id} up`, onclick: guard(() => save([...list.slice(0, i - 1), id, list[i - 1], ...list.slice(i + 1)])) }, 'Up'),
        h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Remove ${id}`, onclick: guard(() => save(list.filter(x => x !== id))) }, 'Remove')))),
      add].filter(Boolean));
  };
  guard(async () => render(JSON.parse((await api('GET', '/api/settings')).text)))();
  return [h('h2', {}, 'Reliability'), card];
}

// settings.json "permissions", like VS Code's approvals. The default (ask, or on for tools that never ask) is stored as no entry.
const TOOL_GROUPS = [
  ['Run commands', ['Bash'], 'The command rules below can allow or block single commands.'],
  ['Edit files', ['Write', 'Edit', 'NotebookEdit'], 'Allow is Accept edits in every chat. Files in .nexus and .git still ask.'],
  ['Read files outside the project', ['Read', 'Glob', 'Grep'], 'Reading inside the project never asks.'],
  ['Fetch web pages', ['WebFetch']], ['Screenshots', ['Screenshot']], ['Use a browser (click and type in pages)', ['Browser']],
  ['Search the web', ['web_search'], '', true], ['Subagents', ['Task'], '', true], ['Skills', ['Skill'], '', true],
];
function permissionsCard(area, mcp) {
  const card = h('div', { class: 'card form' });
  const render = st => {
    const p = st.permissions && typeof st.permissions === 'object' ? st.permissions : {};
    const tools = { ...p.tools }, commands = { ...p.commands };
    const save = async (msg) => {
      const clean = o => (Object.keys(o).length ? o : undefined);
      const next = clean({ ...p, tools: clean(tools), commands: clean(commands) });
      render(await putSettings(area, { permissions: next }));
      if (msg) toast(msg);
    };
    const groups = [...TOOL_GROUPS, ...mcp.map(s => [`MCP server ${s.name}`, [`mcp__${s.name}`]])];
    const toolRow = ([label, names, hint, quiet]) => {
      const id = `perm-${names[0]}`;
      const pick = h('select', { class: 'field perm', id, onchange: guard(() => {
        for (const n of names) if (pick.value) tools[n] = pick.value; else delete tools[n];
        return save(`${label}: ${pick.selectedOptions[0].textContent}.`);
      }) }, (quiet ? [['', 'On'], ['deny', 'Off']] : [['', 'Ask'], ['allow', 'Allow'], ['deny', 'Off']]).map(([v, t]) => h('option', { value: v, selected: (tools[names[0]] || '') === v }, t)));
      return h('div', {}, h('div', { class: 'rowline' }, h('label', { class: 'grow', htmlFor: id }, label), pick), hint && h('p', { class: 'small muted' }, hint));
    };
    const rule = h('input', { class: 'field mono grow', id: 'perm-rule', placeholder: 'npm test, or /^git (status|diff)\\b/', spellcheck: false, autocapitalize: 'off', 'aria-describedby': 'perm-hint' });
    const how = h('select', { class: 'field perm', 'aria-label': 'What the rule does' }, h('option', { value: 'allow' }, 'Allow'), h('option', { value: 'ask' }, 'Always ask'), h('option', { value: 'deny' }, 'Block'));
    const add = guard(() => {
      const r = rule.value.trim();
      if (!r) return toast('Type the start of a command, or a /regular expression/.');
      if (/^\/.+\/[a-z]*$/s.test(r)) { try { new RegExp(r.slice(1, r.lastIndexOf('/')), r.slice(r.lastIndexOf('/') + 1)); } catch (e) { return toast(`That regular expression doesn't work: ${e.message}`); } }
      commands[r] = how.value;
      return save(`Added the rule for ${r}.`);
    });
    const importVS = guard(async () => {
      const { sources } = await api('GET', '/api/vscode/permissions');
      if (!sources.length) return toast('No terminal approval rules (chat.tools.terminal.autoApprove) found in VS Code, Cursor, Windsurf or VSCodium settings on this computer.');
      const fresh = Object.assign({}, ...sources.map(s => s.commands));
      for (const r of Object.keys(commands)) delete fresh[r]; // rules you already have here stay as they are
      const n = Object.keys(fresh).length;
      const ok = await dialog({ title: 'Import from VS Code', wide: true,
        body: h('div', { class: 'form' }, sources.map(s => h('p', { class: 'small muted' }, `${s.app}: ${Object.keys(s.commands).length} rules in ${s.file}`)),
          n ? h('div', { class: 'out' }, Object.entries(fresh).map(([r, v]) => `${v === 'allow' ? 'Allow ' : 'Always ask'}  ${r}`).join('\n')) : h('p', {}, 'You already have all of these rules.'),
          h('p', { class: 'small muted' }, "VS Code's true becomes Allow and false becomes Always ask.")),
        actions: [{ label: 'Cancel' }, ...(n ? [{ label: `Add ${n} rule${n === 1 ? '' : 's'}`, class: 'primary', value: true }] : [])] });
      if (!ok) return;
      Object.assign(commands, fresh);
      await save(`Imported ${n} rule${n === 1 ? '' : 's'} from VS Code.`);
    });
    const list = Object.entries(commands);
    card.replaceChildren(...[
      h('div', { class: 'title' }, 'Tools'),
      ...groups.map(toolRow),
      h('div', { class: 'rowline' }, h('label', { class: 'title grow', htmlFor: 'perm-rule' }, 'Command rules'), h('button', { class: 'btn small', type: 'button', onclick: importVS }, 'Import from VS Code')),
      h('p', { class: 'small muted', id: 'perm-hint' }, 'A rule is the start of a command (npm test) or a /regular expression/. Commands joined with ; && || or | each need an allow rule, and a command with $( ), backticks or redirection is never allowed by a rule. Block stops a command in every mode, even bypass, but it is a guard rail rather than a sandbox: it matches how a command is written.'),
      list.length > 0 && h('div', { class: 'permlist' }, list.map(([r, v]) => h('div', { class: 'rowline' }, h('span', { class: 'grow mono' }, r),
        h('span', { class: `ptag ${v}` }, v === 'allow' ? 'Allow' : v === 'ask' ? 'Always ask' : 'Block'),
        h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Remove the rule ${r}`, onclick: guard(() => { delete commands[r]; return save(`Removed the rule for ${r}.`); }) }, 'Remove')))),
      h('div', { class: 'rowline' }, rule, how, h('button', { class: 'btn', type: 'button', onclick: add }, 'Add')),
    ].filter(Boolean));
  };
  guard(async () => render(JSON.parse((await api('GET', '/api/settings')).text)))();
  return [h('h2', {}, 'Permissions'), h('p', { class: 'small muted' }, 'What the AI may do without asking, in every chat. Approvals you give in a chat, the risk check and plan mode still apply.'), card];
}

function notifyCard() {
  const supported = 'Notification' in window;
  const box = h('input', { type: 'checkbox', id: 'notify', disabled: !supported, checked: supported && pref('nexus.notify') === '1' && Notification.permission === 'granted', onchange: async () => {
    if (box.checked && Notification.permission !== 'granted') box.checked = (await Notification.requestPermission()) === 'granted';
    pref('nexus.notify', box.checked ? '1' : '0');
    if (canPush) setPush(box.checked).catch(err => toast(`Push notifications didn't turn ${box.checked ? 'on' : 'off'}: ${err.message}`));
    if (box.checked) new Notification('Nexus', { body: 'Notifications are on.', icon: '/icon-180.png' });
  } });
  // null: not on this computer's screen, or nowhere to show them (a Linux server without a desktop).
  const pc = S.me?.desktopNotify != null && h('input', { type: 'checkbox', id: 'pcnotify', checked: S.me.desktopNotify, onchange: guard(async () => {
    const { text } = await api('GET', '/api/settings');
    await api('PUT', '/api/settings', { text: `${JSON.stringify({ ...JSON.parse(text), desktopNotify: pc.checked ? undefined : false }, null, 2)}\n` });
    S.me.desktopNotify = pc.checked;
    toast(pc.checked ? 'This computer will notify you when a chat finishes or needs you.' : "This computer's own notifications are off.");
  }) });
  return [h('h2', {}, 'Notifications'),
    pc && h('label', { class: 'card rowline check', htmlFor: 'pcnotify' }, pc, h('span', { class: 'grow' }, "Notify me on this computer when a chat finishes or needs me, even with no browser open, unless I'm looking at Nexus")),
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

// Updates come straight from the GitHub repo: the card lists what's new and installs it in one click. The server merges it with
// your own changes, runs the tests, and restarts (Linux service, Windows launcher); anything that fails leaves the code as it was.
async function versionCard() {
  const card = h('div', { class: 'card form' });
  let polling = false;
  const show = async () => {
    const v = await api('GET', '/api/version').catch(() => null);
    if (!v) return card.replaceChildren(h('div', { class: 'small muted' }, 'Version unavailable.'));
    markUpdates(v);
    const n = v.behind, s = n === 1 ? '' : 's';
    const state = v.updating ? 'Installing the update: merging it with your changes and running the tests. This takes a minute or two.'
      : v.restart ? 'An update is installed. Restart Nexus to start using it.'
      : n ? `${n} update${s} available.` : 'Up to date.';
    const install = guard(async () => {
      await api('POST', '/api/update', {});
      toast('Installing the update. Nexus restarts by itself when the tests pass, and this page reconnects.', null, 8000);
      watch(v.commit);
    });
    const check = guard(async () => { await api('POST', '/api/update/check', {}); await show(); toast(card.querySelector('.ustate').textContent); });
    const merge = guard(async () => { const { name } = await api('POST', '/api/update/merge', {}); await refreshProjects(); go(name); });
    card.replaceChildren(...[
      h('div', { class: 'rowline' }, h('div', { class: 'grow' }, h('div', { class: 'title mono' }, `v${v.version} · ${v.commit}`), h('div', { class: `ustate${n && !v.updating ? ' title' : ' small muted'}`, role: 'status' }, state)),
        h('button', { class: 'btn', type: 'button', onclick: () => doctorDialog() }, 'Check setup'),
        v.canMerge && h('button', { class: 'btn', type: 'button', onclick: merge }, 'Merge with AI'),
        !v.updating && (n ? h('button', { class: 'btn primary', type: 'button', onclick: install }, `Install update${s}`) : h('button', { class: 'btn', type: 'button', onclick: check }, 'Check for updates'))),
      n > 0 && h('details', { class: 'fold', open: n <= 5 }, h('summary', {}, "What's new"),
        h('ul', { class: 'news' }, v.commits.map(c => h('li', {}, h('span', { class: 'mono muted' }, c.hash), ' ', c.subject)), n > v.commits.length && h('li', { class: 'muted' }, `and ${n - v.commits.length} more`))),
      h('div', { class: 'small muted' }, [v.local ? `${v.local} change${v.local === 1 ? '' : 's'} of your own, which updates keep` : '', v.auto ? 'Installs updates by itself every 6 hours when nothing is running' : 'Checks for updates every 6 hours', v.status && `Last update: ${v.status}`].filter(Boolean).join(' · ')),
      h('div', { class: 'small' }, 'Nexus is open source. ', extLink('Star it on GitHub', 'https://github.com/glsoo/nexus'), ' to help others find it.'),
    ].filter(Boolean));
  };
  // While an update installs, and through the restart that follows, keep the card current.
  const watch = from => {
    if (polling) return;
    polling = true;
    const started = Date.now();
    const tick = async () => {
      const v = await api('GET', '/api/version').catch(() => null);
      if (v && !v.updating) {
        polling = false;
        if (v.commit !== from && !v.restart) toast(`Nexus is updated to ${v.commit}.`);
        return card.isConnected && show();
      }
      if (Date.now() - started < 10 * 60_000) setTimeout(tick, 4000); else polling = false;
    };
    setTimeout(tick, 4000);
  };
  await show();
  return [h('h2', {}, 'Version'), card];
}

// A dot on Settings while updates wait, and a toast the first time each new one shows up.
function markUpdates(v) {
  const nav = document.getElementById('nav-settings');
  nav?.classList.toggle('has-update', v.behind > 0);
  nav?.setAttribute('aria-label', v.behind > 0 ? `Settings, ${v.behind} update${v.behind === 1 ? '' : 's'} available` : 'Settings');
  const head = v.commits[0]?.hash;
  if (!head || pref('nexus.updateSeen') === head) return;
  pref('nexus.updateSeen', head);
  if (S.page !== 'settings') toast(`Nexus has ${v.behind} update${v.behind === 1 ? '' : 's'} on GitHub.`, ['See them', () => go(null, 'settings')], 10000);
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
  api('GET', '/api/version').then(markUpdates).catch(() => {});
  const m = /^#\/(?:p\/([^/]+)\/(\w+)|(agents|settings|marketplace))?/.exec(location.hash) || [];
  const name = m[1] ? decodeURIComponent(m[1]) : null;
  if (m[3]) go(null, m[3]);
  else if (name && S.projects.some(p => p.name === name)) go(name, null, ['chat', 'files', 'changes', 'terminal'].includes(m[2]) ? m[2] : 'chat');
  else if (S.projects[0]) go(S.projects[0].name);
  else go(null);
  S.modelsReady = api('GET', '/api/models').then(list => { S.models = list; syncComposer(); }).catch(() => {});
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
