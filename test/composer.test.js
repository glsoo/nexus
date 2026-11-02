import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('compact message options close outside or on Escape, but not inside a modal', () => {
  const start = app.indexOf('function closeComposerOptions(');
  const end = app.indexOf('\ndocument.addEventListener', start);
  assert.ok(start >= 0 && end > start);
  assert.match(app, /document\.addEventListener\('keydown', closeComposerOptions, true\)/, 'dismissal must run before the textarea interrupt handler');
  let modal = false, focused = 0, prevented = 0, stopped = 0;
  const inside = {};
  const options = { open: true, contains: target => target === inside, querySelector: () => ({ focus: () => focused++ }) };
  const document = { querySelector: selector => selector === 'dialog[open]' ? modal : options.open ? options : null };
  const close = vm.runInNewContext(`(${app.slice(start, end)})`, { document });
  close({ type: 'pointerdown', target: inside });
  assert.equal(options.open, true);
  close({ type: 'keydown', key: 'Tab' });
  assert.equal(options.open, true);
  close({ type: 'pointerdown', target: {} });
  assert.equal(options.open, false);
  assert.equal(focused, 0, 'outside clicks must not steal focus from their target');
  options.open = true;
  const escape = { type: 'keydown', key: 'Escape', preventDefault: () => prevented++, stopPropagation: () => stopped++ };
  modal = true;
  close(escape);
  assert.equal(options.open, true, 'Escape belongs to the open modal');
  assert.equal(prevented, 0);
  modal = false;
  close(escape);
  assert.equal(options.open, false);
  assert.equal(focused, 1);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1, 'closing options must not also interrupt the agent');
  close(escape);
  assert.equal(focused, 1);
});

test('compact controls keep permission status and Send/Queue names accessible', () => {
  const start = app.indexOf('function syncComposer(');
  const end = app.indexOf('\nlet uidN', start);
  assert.ok(start >= 0 && end > start);
  const summary = { dataset: {} };
  const emptyClasses = { toggle() {} };
  const context = {
    S: { state: { mode: 'default', model: 'preview', effort: 'medium', running: false, usage: { lastInput: 0 }, compactAt: 100000, todos: [] }, models: [], meta: { agents: [] }, prompts: null },
    MODES: [['default', 'Ask first'], ['bypass', 'Bypass'], ['plan', 'Plan']],
    $input: { isConnected: true },
    $mode: { closest: () => ({ querySelector: () => summary }) },
    $modelLabel: {}, $agentLabel: {}, $agentBtn: { classList: emptyClasses }, $promptBtn: { classList: emptyClasses },
    $stopBtn: {}, $sendBtn: {}, $meter: {}, $todos: { replaceChildren() {} }, syncTokens: null, fmt: n => String(n),
  };
  vm.runInNewContext(app.slice(start, end), context);
  context.syncComposer();
  assert.equal(context.$sendBtn.ariaLabel, 'Send');
  assert.equal(context.$stopBtn.hidden, true);
  assert.equal(summary.dataset.mode, 'default');
  assert.match(summary.ariaLabel, /Ask first/);
  context.S.state.running = true;
  context.S.state.mode = 'bypass';
  context.syncComposer();
  assert.equal(context.$sendBtn.ariaLabel, 'Queue');
  assert.equal(context.$sendBtn.title, 'Queue');
  assert.equal(context.$stopBtn.hidden, false);
  assert.equal(summary.dataset.mode, 'bypass');
  assert.match(summary.ariaLabel, /Bypass/);
  context.S.state.mode = 'plan';
  context.syncComposer();
  assert.equal(summary.dataset.mode, 'plan');
  assert.match(summary.ariaLabel, /Plan/);
});

test('compact composer uses a single tool row and suppresses pseudo-element motion when requested', () => {
  assert.match(css, /\.cbar\s*\{[^}]*flex-wrap: nowrap/);
  assert.match(css, /\.composer-settings\s*\{[^}]*position: absolute/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
  assert.match(css, /@media \(hover: hover\) and \(prefers-reduced-motion: no-preference\)\s*\{\s*\.btn:hover:not\(:disabled\):not\(:active\)/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\*, \*::before, \*::after\s*\{[^}]*animation: none !important/);
  assert.match(css, /\.cbar \.send-btn, \.cbar \.stop-btn\s*\{ width: 44px; height: 44px; min-height: 44px/);
});
