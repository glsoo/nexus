import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const section = (start, end) => {
  const at = app.indexOf(start), to = app.indexOf(end, at);
  assert.ok(at >= 0 && to > at);
  return app.slice(at, to);
};
const node = (tag, props = {}, ...children) => ({
  tag, ...props, children: children.flat(Infinity),
  replaceChildren(...kids) { this.children = kids; },
  append(...kids) { this.children.push(...kids); },
});

function sendContext() {
  const sent = [], notices = [], commands = [];
  const context = {
    S: { project: 'demo', images: [], ws: { readyState: 1 } },
    $input: { value: '  First message  ' }, $slash: { hidden: false },
    drafts: { demo: '  First message  ' }, fileHits: {},
    dictation: { abort() { context.aborted = true; } },
    toast: text => notices.push(text), sendWs: message => sent.push(message),
    localCommand: text => { commands.push(text); return text === '/files'; },
    grow() {}, syncThumbs() {},
  };
  vm.runInNewContext(section('function send()', '\nfunction addFiles'), context);
  return { context, sent, notices, commands };
}

function mountComposer(context) {
  Object.assign(context, {
    h: node, icon: name => node('svg', { name }), guard: fn => fn,
    MODES: [['default', 'Ask first']], Speech: undefined,
    setMode() {}, toggleAutopilot() {}, agentPicker() {}, promptsDialog() {}, modelPicker() {}, tokenPanel() {},
    touch: { matches: false }, updateSlash() {},
  });
  return vm.runInNewContext(`(${section('function composer()', '\nconst EFFORTS')})`, context)();
}

test('one completed Send activation submits once, while pressing or canceling does not submit', () => {
  const { context, sent } = sendContext();
  mountComposer(context);
  let prevented = false;
  context.$sendBtn.onmousedown({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'keep the textarea focused so the keyboard cannot move Send');
  assert.equal(sent.length, 0, 'pressing without completing the click must not send');
  assert.equal(context.$sendBtn.onpointerdown, undefined, 'do not submit on pointerdown');
  context.$sendBtn.onclick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].t, 'send');
  assert.equal(sent[0].text, 'First message');
  assert.equal(context.$input.value, '');
  assert.equal(context.drafts.demo, undefined);
  assert.equal(context.aborted, true);
  context.$sendBtn.onclick();
  assert.equal(sent.length, 1, 'an empty second activation must not duplicate the message');
});

test('disconnected sending preserves text, attachments and drafts until one successful retry', () => {
  const { context, sent, notices } = sendContext();
  const images = context.S.images = ['data:image/png;base64,fixture'];
  context.S.ws.readyState = 3;
  context.send();
  assert.equal(sent.length, 0);
  assert.equal(context.$input.value, '  First message  ');
  assert.equal(context.drafts.demo, '  First message  ');
  assert.equal(context.S.images, images);
  assert.equal(context.$slash.hidden, false);
  assert.match(notices[0], /Not connected/);
  context.S.ws.readyState = 1;
  context.send();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].images, images);
  assert.equal(context.S.images.length, 0);
});

test('Send supports image-only messages and keeps local slash commands local', () => {
  const { context, sent, commands } = sendContext();
  context.$input.value = '/files';
  context.send();
  assert.deepEqual(commands, ['/files']);
  assert.equal(sent.length, 0);
  assert.equal(context.$input.value, '');
  context.S.images = ['data:image/png;base64,fixture'];
  context.send();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, '');
  assert.equal(sent[0].images.length, 1);
});

test('desktop Enter sends once but Shift+Enter, IME composition and mobile Enter do not send', () => {
  const { context, sent } = sendContext();
  mountComposer(context);
  context.$slash.hidden = true;
  let prevented = 0;
  const key = extra => context.$input.onkeydown({ key: 'Enter', preventDefault() { prevented++; }, ...extra });
  key({ shiftKey: true });
  key({ isComposing: true });
  context.touch.matches = true;
  key({});
  assert.equal(sent.length, 0);
  context.touch.matches = false;
  key({});
  assert.equal(sent.length, 1);
  assert.equal(prevented, 1);
});

test('same-project state snapshots refresh the transcript without detaching the composer or stealing focus', () => {
  const input = { isConnected: true, value: 'Unsent draft', focus() { assert.fail('snapshot must not steal focus'); } };
  const send = {}, stop = {}, old = { id: 'old' }, log = node('div');
  const context = {
    S: { project: 'demo', tab: 'chat', page: null, state: { name: 'demo', log: [] }, images: ['attachment'] },
    $input: input, $sendBtn: send, $stopBtn: stop, $log: log,
    drafts: { demo: 'Unsent draft' }, entries: new Map([['old', old]]), h: node,
    upsertEntry(entry, follow) { assert.equal(follow, false); context.entries.set(entry.id, entry); log.append(entry); },
    syncComposer() { context.synced = (context.synced || 0) + 1; },
    render() { assert.fail('replacing the composer between pointerdown and pointerup loses the first click'); },
    syncTitle() { context.titleSynced = true; },
    motion() {}, FADE: [], jumpTo: id => { context.jumped = id; },
  };
  vm.runInNewContext(section('function syncChat()', '\nlet following'), context);
  vm.runInNewContext(section('function onEvent(', '\n// ---- chat'), context);
  const snapshot = { name: 'demo', running: true, log: [{ id: 'new', text: 'Updated' }] };
  context.S.jump = 'new';
  context.onEvent({ t: 'state', state: snapshot });
  assert.equal(context.S.state, snapshot);
  assert.equal(context.$input, input);
  assert.equal(context.$sendBtn, send);
  assert.equal(context.$stopBtn, stop);
  assert.equal(input.value, 'Unsent draft');
  assert.equal(context.drafts.demo, 'Unsent draft');
  assert.deepEqual(context.S.images, ['attachment']);
  assert.equal(context.entries.has('old'), false);
  assert.equal(log.children[0], snapshot.log[0]);
  assert.equal(context.synced, 1);
  assert.equal(context.titleSynced, true);
  assert.equal(context.jumped, 'new');
  context.S.state = null;
  context.onEvent({ t: 'state', state: { name: 'demo', log: [] } });
  assert.equal(context.$input, input, 'even the first snapshot must preserve an already-mounted composer');
  assert.equal(log.children[0].id, 'hello');
  input.isConnected = false;
  context.render = () => { context.rendered = true; };
  context.onEvent({ t: 'state', state: snapshot });
  assert.equal(context.rendered, true, 'rebuild only when there is no mounted chat');
});

test('inline controls synchronize permissions, Send/Queue, Stop, autopilot and costs', () => {
  const classes = new Set();
  const emptyClasses = { toggle() {} };
  const context = {
    S: { state: { mode: 'default', model: 'preview', effort: 'medium', running: false, usage: { lastInput: 0 }, compactAt: 100000, todos: [] }, models: [], meta: { agents: [] }, prompts: null },
    $input: { isConnected: true }, $mode: {},
    $modelLabel: {}, $agentLabel: {}, $agentBtn: { classList: emptyClasses }, $promptBtn: { classList: emptyClasses },
    $autoBtn: { classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) }, setAttribute(name, value) { this[name] = value; } },
    $stopBtn: {}, $sendBtn: {}, $meter: node('button'), $todos: node('div'), syncTokens: null, fmt: n => String(n),
    h: node, usd: n => `$${n.toFixed(2)}`,
  };
  vm.runInNewContext(section('function syncComposer(', '\nlet uidN'), context);
  context.syncComposer();
  assert.equal(context.$mode.value, 'default');
  assert.equal(context.$sendBtn.ariaLabel, 'Send');
  assert.equal(context.$stopBtn.hidden, true);
  context.S.state.running = true;
  for (const mode of ['bypass', 'plan']) {
    context.S.state.mode = mode;
    context.syncComposer();
    assert.equal(context.$mode.value, mode);
    assert.equal(context.$mode.className, mode);
  }
  assert.equal(context.$sendBtn.textContent, 'Queue');
  assert.equal(context.$sendBtn.ariaLabel, 'Queue');
  assert.equal(context.$sendBtn.title, 'Queue');
  assert.equal(context.$stopBtn.hidden, false);
  context.S.state.autopilot = true;
  context.S.state.usage.cost = 1.23;
  context.syncComposer();
  assert.equal(classes.has('on'), true);
  assert.equal(context.$autoBtn['aria-pressed'], 'true');
  assert.match(context.$autoBtn.title, /without asking/);
  assert.equal(context.$meter.ariaLabel, 'Tokens, cost and compacting');
  assert.equal(context.$meter.children[1].class, 'mcost');
  assert.equal(context.$meter.children[1].children[0], ' · $1.23');
  context.S.state.autopilot = false;
  context.S.state.usage.cost = 0;
  context.S.state.running = false;
  context.syncComposer();
  assert.equal(classes.has('on'), false);
  assert.equal(context.$autoBtn['aria-pressed'], 'false');
  assert.equal(context.$meter.children[1], '');
  assert.equal(context.$sendBtn.textContent, 'Send');
  context.$input.isConnected = false;
  context.S.state.running = true;
  context.syncComposer();
  assert.equal(context.$stopBtn.hidden, true, 'updates do not touch detached controls');
});

test('default wrapping composer keeps a fixed right-aligned Send/Queue slot and full touch targets', () => {
  assert.match(css, /\.cbar\s*\{[^}]*flex-wrap: wrap;/);
  assert.match(css, /\.cbar > \.btn\.primary\s*\{[^}]*margin-left: auto; width: 72px; flex: none; align-self: flex-end;/);
  assert.match(css, /\.cbar > \.btn\.primary:active\s*\{ transform: none; \}/, 'pressing Send must not shrink its hit target away from the pointer');
  const touch = css.slice(css.indexOf('@media (pointer: coarse)'));
  assert.match(touch, /\.icon-btn\s*\{ width: 44px; height: 44px;/);
  assert.match(touch, /\.btn, \.btn\.small, \.tab, \.cbar select, \.mbtn, \.seg button\s*\{ min-height: 44px;/);
  assert.doesNotMatch(css, /\.send-btn::|\.stop-btn::|\.composer-settings/);
});
