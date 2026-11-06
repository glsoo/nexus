import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const part = (start, end) => {
  const a = app.indexOf(start), b = app.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing frontend section: ${start}`);
  return app.slice(a, b);
};
const presets = [
  { id: 'personal', label: 'Personal', subtitle: 'Vibe coding', description: 'For you and your prototypes. Keep planning light, build a small step and check it works.' },
  { id: 'shared', label: 'Shared', subtitle: 'Prompt engineering', description: 'For other people to use. Define users, narrow the scope and agree acceptance criteria before building.' },
  { id: 'commercial', label: 'Commercial', subtitle: 'Guardrails', description: 'For a product you plan to sell. Add project rules, stronger tests, security and readiness checks to Shared.' },
];
const find = (el, predicate) => !el || typeof el !== 'object' ? [] : [
  ...(predicate(el) ? [el] : []), ...el.children.flatMap(child => find(child, predicate)),
];
const hasClass = (el, name) => el.className.split(' ').includes(name);
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const fire = (el, event, extra = {}) => {
  const e = { target: el, currentTarget: el, preventDefault() { this.prevented = true; }, ...extra };
  for (const fn of el.events[event] || []) fn(e);
  return e;
};

function fixture({ state, meta } = {}) {
  let document;
  function element(tag) {
    const el = {
      tag, children: [], events: {}, className: '', value: '', disabled: false, hidden: false,
      style: {}, ariaLabel: '',
      setAttribute(key, value) { this[key] = value; if (key === 'aria-label') this.ariaLabel = value; },
      addEventListener(key, fn) { (this.events[key] ||= []).push(fn); },
      append(...children) {
        for (const child of children) {
          if (typeof child === 'object') child.parent = this;
          this.children.push(child);
        }
      },
      replaceChildren(...children) { this.children = []; this.append(...children); },
      focus() { document.activeElement = this; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; },
      showModal() { this.open = true; },
      close() { this.open = false; fire(this, 'close'); },
      get isConnected() { return this === document.body || Boolean(this.parent?.isConnected); },
      get textContent() { return this.children.map(child => typeof child === 'object' ? child.textContent : String(child)).join(''); },
      set textContent(value) { this.children = [value]; },
      set innerHTML(_) { assert.fail('Build quality metadata must be rendered as text, never HTML'); },
    };
    el.classList = {
      toggle(name, on) {
        const names = new Set(el.className.split(' ').filter(Boolean));
        if (on) names.add(name); else names.delete(name);
        el.className = [...names].join(' ');
      },
      add(name) { this.toggle(name, true); },
    };
    return el;
  }
  document = { createElement: element, activeElement: null };
  document.body = element('body');
  const sent = [], toasts = [], drafts = { demo: 'Keep this unsent draft' };
  const S = {
    project: 'demo', tab: 'chat', page: null, images: ['attachment'], models: [], prompts: null,
    state: { name: 'demo', quality: 'personal', mode: 'default', model: 'fixture-model', effort: 'medium', autopilot: false, budget: 5, allow: ['Read:*'], running: false, usage: { lastInput: 0, cost: 0 }, compactAt: 1000, todos: [], log: [], ...state },
    meta: { agents: [], qualityPresets: presets.map(p => ({ ...p })), ...meta },
    ws: { readyState: 1, send: message => sent.push(JSON.parse(message)) },
  };
  const context = vm.createContext({
    S, drafts, document, icon: () => element('svg'), guard: fn => fn,
    toast: text => toasts.push(text), phone: { matches: false }, touch: { matches: false }, Speech: undefined,
    MODES: [{ id: 'default', label: 'Ask first' }], setMode() {}, toggleAutopilot() {}, agentPicker() {}, promptsDialog() {}, modelPicker() {}, tokenPanel() {}, send() {}, syncThumbs() {},
    exit: async () => {}, fmt: String, usd: n => `$${n}`, $todos: element('div'),
    $log: element('div'), $review: element('div'), entries: new Map(),
    syncTitle() {}, finished() {}, refreshReview() {}, filesChanged() {}, motion() {}, FADE: [],
    syncChat() { context.syncComposer(); }, render() { assert.fail('Build quality must not rebuild the chat'); },
    api() { assert.fail('Choosing a build quality must not call a model or API'); },
  });
  vm.runInContext([
    part('function h(', '\nconst ICONS'),
    part('const sendWs =', '\nfunction onEvent'),
    part('function onEvent(', '\n// ---- chat'),
    part('function composer()', '\nconst EFFORTS'),
    part('function setOption(', '\n// Turns a saved rule'),
    'let syncTokens = null;',
    part('function syncComposer()', '\nlet uidN'),
    part('const sheet =', '\nconst projectForInstall'),
    'document.body.append(composer()); syncComposer(); this.sendWs = sendWs;',
  ].join('\n'), context);
  const picker = () => {
    fire(context.$qualityBtn, 'click');
    return find(document.body, el => el.tag === 'dialog')[0];
  };
  const cards = dialog => find(dialog, el => hasClass(el, 'qcard'));
  return { context, S, document, sent, toasts, drafts, picker, cards };
}

test('Build quality uses three metadata cards and literal text, separate from permission and model controls', () => {
  const metadata = presets.map(p => ({ ...p, description: `${p.description} <img src=x onerror=alert(1)>` }));
  const f = fixture({ meta: { qualityPresets: metadata } });
  assert.equal(f.context.$qualityBtn.disabled, false);
  assert.equal(f.context.$qualityLabel.textContent, 'Personal');
  assert.match(f.context.$qualityBtn.textContent, /Build quality ·Personal/);
  assert.equal(f.context.$qualityBtn['aria-haspopup'], 'dialog');
  const d = f.picker(), cards = f.cards(d);
  assert.equal(d.open, true);
  assert.equal(d['aria-label'], 'Build quality');
  assert.equal(cards.length, 3);
  for (let i = 0; i < cards.length; i++) {
    assert.equal(find(cards[i], el => hasClass(el, 'qname'))[0].children[0], metadata[i].label);
    assert.equal(find(cards[i], el => hasClass(el, 'qsubtitle'))[0].textContent, metadata[i].subtitle);
    assert.equal(find(cards[i], el => hasClass(el, 'qabout'))[0].textContent, metadata[i].description);
    assert.equal(cards[i]['aria-pressed'], String(i === 0));
    assert.equal(find(cards[i], el => hasClass(el, 'qselected'))[0].hidden, i !== 0);
  }
  assert.equal(find(d, el => el.tag === 'img').length, 0);
  assert.match(d.textContent, /permissions stay unchanged/);
  assert.match(d.textContent, /next AI request in this chat/);
  assert.match(d.textContent, /Commercial is not a guarantee your product is ready to sell/);
  assert.equal(f.sent.length, 0, 'opening and reading profiles never runs a model');
});

test('choosing each quality sends only its option and preserves draft, history, images and all unrelated settings', async () => {
  for (const id of ['shared', 'commercial', 'personal']) {
    const f = fixture({ state: { quality: id === 'personal' ? 'shared' : 'personal' } });
    const before = plain(f.S.state), input = f.context.$input, log = f.S.state.log;
    const d = f.picker(), index = presets.findIndex(p => p.id === id);
    fire(f.cards(d)[index], 'click');
    await tick();
    assert.deepEqual(f.sent, [{ t: 'option', key: 'quality', value: id }]);
    assert.deepEqual(plain(f.S.state), { ...before, quality: id });
    assert.equal(f.S.state.log, log);
    assert.equal(f.context.$input, input);
    assert.equal(input.value, 'Keep this unsent draft');
    assert.equal(f.drafts.demo, input.value);
    assert.deepEqual(f.S.images, ['attachment']);
    assert.equal(f.context.$qualityLabel.textContent, presets[index].label);
    assert.equal(find(f.document.body, el => el.tag === 'dialog').length, 0);
    assert.equal(f.document.activeElement, f.context.$qualityBtn, 'restore focus to the opener');
  }
});

test('status refreshes the current label and selected aria without stealing picker focus', () => {
  const f = fixture();
  const d = f.picker(), cards = f.cards(d);
  cards[1].focus();
  f.context.onEvent({ t: 'status', ...f.S.state, quality: 'commercial' });
  assert.equal(f.S.state.quality, 'commercial');
  assert.equal(f.context.$qualityLabel.textContent, 'Commercial');
  assert.match(f.context.$qualityBtn.ariaLabel, /Commercial · Guardrails/);
  assert.deepEqual(cards.map(card => card['aria-pressed']), ['false', 'false', 'true']);
  assert.deepEqual(cards.map(card => find(card, el => hasClass(el, 'qselected'))[0].hidden), [true, true, false]);
  assert.equal(f.document.activeElement, cards[1]);
  assert.equal(f.sent.length, 0);
  assert.equal(f.context.$input.value, f.drafts.demo);
});

test('reconnect snapshots refresh quality without rebuilding the composer; late snapshots from another chat are ignored', () => {
  const f = fixture(), input = f.context.$input;
  const snapshot = { ...f.S.state, quality: 'shared' };
  f.context.onEvent({ t: 'state', state: snapshot });
  assert.equal(f.S.state, snapshot);
  assert.equal(f.context.$qualityLabel.textContent, 'Shared');
  assert.equal(f.context.$input, input);
  assert.equal(input.value, f.drafts.demo);
  f.context.onEvent({ t: 'state', state: { ...snapshot, name: 'previous-chat', quality: 'commercial' } });
  assert.equal(f.S.state, snapshot, 'a late snapshot cannot leak another chat\'s quality into this one');
  assert.equal(f.context.$qualityLabel.textContent, 'Shared');
});

test('missing, incomplete and unknown metadata disable the control without offering a fake choice', () => {
  for (const qualityPresets of [undefined, null, {}, [], presets.slice(0, 2), [...presets, { id: 'unknown' }], presets.map(p => p.id === 'shared' ? { ...p, id: 'unknown' } : p), presets.map(p => ({ ...p, description: '' }))]) {
    const f = fixture({ meta: { qualityPresets } });
    assert.equal(f.context.$qualityBtn.disabled, true);
    assert.equal(f.context.$qualityLabel.textContent, 'Unavailable');
    assert.match(f.context.$qualityBtn.title, /loading or updating/);
    assert.equal(f.picker(), undefined);
    assert.equal(f.sent.length, 0);
  }
  const f = fixture({ state: { quality: 'unknown' } });
  assert.equal(f.context.$qualityBtn.disabled, true);
  assert.equal(f.picker(), undefined);
  f.S.state = null;
  f.context.syncComposer();
  assert.equal(f.context.$qualityLabel.textContent, 'Loading…');
  assert.equal(f.context.$qualityBtn.disabled, true);
  f.S.state = { name: 'demo', ...fixture().S.state, quality: undefined };
  f.context.syncComposer();
  assert.equal(f.context.$qualityLabel.textContent, 'Personal', 'missing saved quality uses the server contract default');
});

test('offline and thrown socket failures preserve the profile and leave the picker available for retry', async () => {
  for (const failure of ['closed', 'missing', 'throws']) {
    const f = fixture();
    if (failure === 'closed') f.S.ws.readyState = 3;
    if (failure === 'missing') f.S.ws = null;
    if (failure === 'throws') f.S.ws.send = () => { throw new Error('Socket closed'); };
    const before = plain(f.S.state), d = f.picker(), cards = f.cards(d);
    fire(cards[1], 'click');
    await tick();
    assert.deepEqual(plain(f.S.state), before);
    assert.equal(f.context.$qualityLabel.textContent, 'Personal');
    assert.equal(cards[0]['aria-pressed'], 'true');
    assert.equal(cards[1]['aria-pressed'], 'false');
    assert.equal(d.open, true);
    assert.equal(f.sent.length, 0);
    assert.match(f.toasts[0], /Not connected/);
    assert.equal(f.context.$input.value, f.drafts.demo);
    f.S.ws = { readyState: 1, send: message => f.sent.push(JSON.parse(message)) };
    fire(cards[1], 'click');
    await tick();
    assert.equal(f.S.state.quality, 'shared');
    assert.deepEqual(f.sent, [{ t: 'option', key: 'quality', value: 'shared' }]);
  }
});

test('the shared option helper retains other option messages, sends first and returns success truthfully', () => {
  const f = fixture();
  const values = { mode: 'plan', model: 'another-model', effort: 'high', autopilot: true, budget: 10, allow: ['Read:*', 'Write:*'], agent: 'example' };
  for (const [key, value] of Object.entries(values)) {
    const before = plain(f.S.state);
    f.S.ws.readyState = 3;
    assert.equal(f.context.setOption(key, value), false);
    assert.deepEqual(plain(f.S.state), before);
    f.S.ws.readyState = 1;
    f.S.ws.send = message => {
      assert.deepEqual(plain(f.S.state), before, 'the option must not change until send succeeds');
      f.sent.push(JSON.parse(message));
    };
    assert.equal(f.context.setOption(key, value), true);
    assert.deepEqual(f.sent.at(-1), { t: 'option', key, value });
    assert.deepEqual(plain(f.S.state), { ...before, [key]: value });
  }
  f.S.ws.send = message => f.sent.push(JSON.parse(message));
  assert.equal(f.context.sendWs({ t: 'visible', on: true }), true);
  f.S.ws.readyState = 3;
  assert.equal(f.context.sendWs({ t: 'visible', on: true }), false);
});

test('keyboard focus starts on the selection, arrows navigate without choosing, and Escape restores the opener', async () => {
  const f = fixture({ state: { quality: 'shared' } });
  const d = f.picker(), cards = f.cards(d);
  assert.equal(f.document.activeElement, cards[1]);
  assert.equal(fire(d, 'keydown', { key: 'ArrowDown' }).prevented, true);
  assert.equal(f.document.activeElement, cards[2]);
  fire(d, 'keydown', { key: 'Home' });
  assert.equal(f.document.activeElement, cards[0]);
  fire(d, 'keydown', { key: 'ArrowUp' });
  assert.equal(f.document.activeElement, cards[2]);
  fire(d, 'keydown', { key: 'End' });
  assert.equal(f.document.activeElement, cards[2]);
  assert.equal(f.sent.length, 0);
  assert.equal(fire(d, 'cancel').prevented, true, 'native Escape/cancel uses the sheet close path');
  await tick();
  assert.equal(find(f.document.body, el => el.tag === 'dialog').length, 0);
  assert.equal(f.document.activeElement, f.context.$qualityBtn);
  assert.equal(f.S.state.quality, 'shared');
});

test('chat changes and closing a chat dismiss the old picker; the next chat waits for fresh metadata', async () => {
  for (const next of ['other-chat', null]) {
    const f = fixture(), d = f.picker();
    Object.assign(f.context, { drawer() {}, dictation: null, teardownTerm() {}, history: { replaceState() {} }, refreshSoon() {}, loadMeta() {}, $main: { lastElementChild: {} }, RISE: [], pretty: String });
    f.S.alerts = {};
    f.context.render = () => f.context.syncComposer();
    vm.runInContext(part('function go(', '\nasync function loadMeta'), f.context);
    f.context.go(next);
    await tick();
    assert.equal(d.open, false);
    assert.equal(f.S.project, next);
    if (next) {
      assert.equal(f.S.state, null);
      assert.equal(f.S.meta.qualityPresets, undefined);
      assert.equal(f.context.$qualityBtn.disabled, true);
      assert.equal(f.context.$qualityLabel.textContent, 'Loading…');
    }
    assert.deepEqual(f.sent, next ? [{ t: 'open', name: next }] : []);
    assert.equal(f.context.$input.value, f.drafts.demo);
  }
});

test('selecting the current quality only closes; stale choices cannot affect a different chat', async () => {
  const f = fixture();
  let d = f.picker();
  fire(f.cards(d)[0], 'click');
  await tick();
  assert.equal(f.sent.length, 0);
  d = f.picker();
  f.S.project = 'another-chat';
  fire(f.cards(d)[1], 'click');
  await tick();
  assert.equal(f.S.state.quality, 'personal');
  assert.equal(f.sent.length, 0);
  assert.notEqual(f.document.activeElement, f.context.$qualityBtn, 'do not focus the previous chat\'s opener');
});

test('quality styling preserves local tokens, wrapping, touch targets and explicit selected text', () => {
  assert.match(css, /\.composer \.cbar > \.qbtn\.mbtn\s*\{[^}]*max-width: 100%;[^}]*min-height: 44px;/);
  assert.match(css, /\.composer \.cbar > \.qbtn\.mbtn\s*\{ order: 7; flex: none;/);
  assert.match(css, /\.qcard\s*\{[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /\.qcard\.current\s*\{[^}]*border-color: var\(--accent\)/);
  assert.match(css, /\.quality \.mhead \.btn\s*\{ min-height: 44px;/);
  assert.match(css, /\.qlist\s*\{[^}]*grid-auto-rows: max-content;[^}]*padding: 12px;/);
});
