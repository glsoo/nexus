import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const h = (tag, props = {}, ...children) => ({
  tag, ...props, children: children.flat(Infinity).filter(c => c !== false && c != null), style: {}, listeners: [],
  addEventListener(name) { this.listeners.push(name); },
  append(...kids) { this.children.push(...kids); },
  replaceChildren(...kids) { this.children = kids; },
  showModal() { this.open = true; },
});
const find = (el, predicate) => typeof el !== 'object' || el == null ? [] : [
  ...(predicate(el) ? [el] : []), ...el.children.flatMap(child => find(child, predicate)),
];
const hasClass = (el, name) => el.class?.split(' ').includes(name);
const mountChat = (context, view) => {
  const start = app.indexOf('function chatView(');
  const end = app.indexOf('\nlet following', start);
  assert.ok(start >= 0 && end > start);
  context.view = view;
  vm.runInNewContext(`${app.slice(start, end)}\nchatView(view);`, context);
};

test('default empty chat shows only its heading, project path and command instructions', () => {
  const context = {
    h, entries: new Map(), S: { state: { log: [] }, project: 'fixture' },
    stopFollow() {}, composer: () => h('div', { class: 'composer' }), syncComposer() {},
    matchMedia: () => ({ matches: false }),
  };
  const view = h('div');
  mountChat(context, view);
  const welcome = find(view, el => el.id === 'hello');
  assert.equal(welcome.length, 1);
  assert.equal(welcome[0].class, 'empty');
  assert.deepEqual(welcome[0].children.map(el => [el.tag, ...el.children]), [
    ['h2', 'What should we build?'],
    ['p', '~/projects/fixture'],
    ['p', 'Type a request. / runs a command and @ points at a file.'],
  ]);
  assert.equal(welcome[0].children[1].class, 'mono');
  assert.equal(view.children[0], context.$log);
  assert.equal(view.children[1], context.$todos);
  assert.equal(view.children.length, 3, 'chat contains the log, todos and composer without a loading row');
  assert.equal(view.children[2].class, 'composer');
  assert.equal(context.$log.role, 'log');
  assert.equal(context.$log['aria-live'], 'polite');
  assert.deepEqual(context.$log.listeners, ['touchstart', 'wheel']);
  assert.equal(context.$todos.hidden, true);
});

test('loading and populated chats retain the default structure without a decorative loading status', () => {
  const entry = { id: 'existing', type: 'assistant', text: 'Ready' };
  for (const state of [null, { log: [], running: true }, { log: [entry], running: true }]) {
    const rendered = [];
    let synced = 0, focused = 0;
    const context = {
      h, entries: new Map([['old', {}]]), S: { state, project: 'fixture' },
      stopFollow() {}, composer: () => h('div', { class: 'composer' }),
      syncComposer() { synced++; }, upsertEntry: (...args) => rendered.push(args),
      matchMedia: () => ({ matches: true }), $input: { focus() { focused++; } },
    };
    const view = h('div');
    mountChat(context, view);
    assert.equal(context.entries.size, 0, 'each chat view discards stale entry nodes');
    assert.equal(view.children.length, 3);
    assert.equal(view.children[0], context.$log);
    assert.equal(view.children[1], context.$todos);
    assert.equal(view.children[2].class, 'composer');
    assert.equal(find(view, el => el.id === 'hello').length, state && !state.log.length ? 1 : 0);
    assert.deepEqual(rendered, state?.log.length ? [[entry, false]] : []);
    assert.equal(synced, 1);
    assert.equal(focused, 1, 'desktop chat navigation still focuses the message input');
    assert.equal(find(view, el => hasClass(el, 'chat-activity') || hasClass(el, 'loading-dot') || hasClass(el, 'welcome-mark')).length, 0);
  }
  assert.doesNotMatch(app, /\$activity\b|chat-activity|loading-dot|welcome-mark/);
});

test('default project tabs use visible text and retain accessible selection and routing', () => {
  const start = app.indexOf('function render()');
  const end = app.indexOf('\n// ---- title and notifications ----', start);
  assert.ok(start >= 0 && end > start);
  const tabs = [['chat', 'Chat'], ['files', 'Files'], ['changes', 'Changes'], ['terminal', 'Terminal']];
  for (const [selected] of tabs) {
    const calls = [];
    const main = h('main');
    const context = {
      h, icon: name => h('svg', { name }), S: { project: 'fixture', tab: selected, page: null },
      document: { getElementById: () => ({ classList: { toggle() {} } }) },
      $main: main, $side: { classList: { contains: () => false } },
      syncTitle() {}, pretty: value => value, navigateTabs() {}, motion() {}, prevTab: 0,
      go: (...args) => calls.push(args), chatView() {}, filesView() {}, changesView() {}, termView() {},
    };
    vm.runInNewContext(`(${app.slice(start, end)})`, context)();
    const tablist = find(main, el => el.role === 'tablist');
    assert.equal(tablist.length, 1);
    assert.equal(tablist[0]['aria-label'], 'Project views');
    const buttons = find(tablist[0], el => el.role === 'tab');
    assert.equal(buttons.length, tabs.length);
    for (let i = 0; i < tabs.length; i++) {
      const [id, label] = tabs[i];
      const button = buttons[i];
      assert.deepEqual(button.children, [label], 'default tabs do not add custom icons');
      assert.equal(button.id, `tab-${id}`);
      assert.equal(button['aria-selected'], String(id === selected));
      assert.equal(button['aria-controls'], 'project-view');
      assert.equal(button.tabIndex, id === selected ? 0 : -1);
      button.onclick();
    }
    assert.deepEqual(calls, tabs.map(([id]) => ['fixture', null, id]));
    const panel = find(main, el => el.role === 'tabpanel');
    assert.equal(panel.length, 1);
    assert.equal(panel[0]['aria-labelledby'], `tab-${selected}`);
  }
});

test('Tokens panel retains live cost details even when mobile hides the inline meter cost', () => {
  const start = app.indexOf('function tokenPanel()');
  const end = app.indexOf('\nfunction syncComposer()', start);
  assert.ok(start >= 0 && end > start);
  const dialogs = [];
  const context = {
    h, S: { state: { usage: { input: 100, cached: 20, output: 10, cost: 1.25, unpriced: 2 }, compactAt: 1000, running: false } },
    document: { activeElement: null, body: { append: el => dialogs.push(el) } },
    fmt: String, usd: value => `$${(value || 0).toFixed(2)}`,
  };
  vm.runInNewContext(`(${app.slice(start, end)})`, context)();
  assert.equal(dialogs.length, 1);
  const dialog = dialogs[0];
  assert.equal(dialog.open, true);
  assert.equal(dialog['aria-label'], 'Tokens and compacting');
  assert.equal(find(dialog, el => el.tag === 'h2')[0].children[0], 'Tokens');
  const stats = find(dialog, el => hasClass(el, 'tstats'))[0];
  const cost = () => stats.children.find(row => row.children[0].children[0] === 'Cost').children[1].children[0];
  assert.equal(cost(), '$1.25 + 2 unpriced requests');
  context.S.state.usage = { input: 0, cached: 0, output: 0, cost: 0, unpriced: 1 };
  context.syncTokens();
  assert.equal(cost(), 'Unknown');
  context.S.state.usage.unpriced = 0;
  context.syncTokens();
  assert.equal(cost(), '$0.00');
});
