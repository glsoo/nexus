import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n'); // a Windows checkout has CRLF
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const token = name => {
  const value = css.match(new RegExp(`--${name}:\\s*(#[a-f0-9]{6})\\b`, 'i'));
  assert.ok(value, `Missing ${name} token`);
  return value[1];
};
const luminance = hex => hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255)
  .map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
  .reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
};

test('default theme keeps opaque black surfaces and readable purple actions', () => {
  for (const [name, value] of Object.entries({ bg: '#000000', panel: '#000000', card: '#111111', raised: '#1c1c1c', fg: '#f5f5f5', muted: '#a1a1a1', accent: '#7e22ce', 'on-accent': '#ffffff' })) {
    assert.equal(token(name), value, `${name} uses the default theme`);
  }
  assert.ok(contrast(token('on-accent'), token('accent')) >= 4.5, 'primary button text contrast');
  for (const foreground of ['fg', 'muted']) {
    for (const background of ['bg', 'card']) {
      assert.ok(contrast(token(foreground), token(background)) >= 4.5, `${foreground} on ${background}`);
    }
  }
  assert.match(css, /\.btn\.primary\s*\{[^}]*background: var\(--accent\);[^}]*color: var\(--on-accent\)/);
  assert.match(css, /\.btn\.primary:hover\s*\{[^}]*background: #9333ea;/);
});

test('default layout uses opaque surfaces without glass tokens or backdrop filters', () => {
  assert.doesNotMatch(css, /--glass-[\w-]+|(?:-webkit-)?backdrop-filter\s*:/);
  assert.match(css, /\.shell\s*\{[^}]*grid-template-columns: 264px minmax\(0, 1fr\);/);
  for (const [selector, background] of [['.side', 'panel'], ['.cbox', 'card'], ['.menu', 'card'], ['.slash', 'card'], ['dialog', 'panel']]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(css, new RegExp(`(?:^|\\n)${escaped}\\s*\\{[^}]*background: var\\(--${background}\\);`));
  }
  assert.match(css, /\.composer\s*\{ flex: none;/);
});

test('project tabs support arrows, wrapping, Home and End without intercepting other keys', () => {
  const start = app.indexOf('function navigateTabs(');
  const end = app.indexOf('\nlet prevTab', start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const context = {
    S: { project: 'demo' },
    go: (...args) => calls.push(['go', ...args]),
    document: { getElementById: id => ({ focus: () => calls.push(['focus', id]) }) },
  };
  vm.runInNewContext(app.slice(start, end), context);
  const tabs = [['chat'], ['files'], ['changes'], ['terminal']];
  for (const [key, at, expected] of [['ArrowRight', 3, 'chat'], ['ArrowLeft', 0, 'terminal'], ['Home', 2, 'chat'], ['End', 0, 'terminal']]) {
    let prevented = false;
    context.navigateTabs({ key, preventDefault() { prevented = true; } }, tabs, at);
    assert.equal(prevented, true);
    assert.deepEqual(calls.splice(0), [['go', 'demo', null, expected], ['focus', `tab-${expected}`]]);
  }
  context.navigateTabs({ key: 'Tab', preventDefault() { assert.fail('Tab must keep native behavior'); } }, tabs, 0);
  assert.equal(calls.length, 0);
});

test('revisiting the terminal respects tablist keyboard focus and detached views', () => {
  const start = app.indexOf('function termView(');
  const end = app.indexOf('\n// ---- agents ----', start);
  assert.ok(start >= 0 && end > start);
  let focusedTab = true, fits = 0, focus = 0;
  const frames = [];
  const current = { project: 'demo', ws: { readyState: 1 }, el: { isConnected: true }, fit: () => fits++, term: { focus: () => focus++ } };
  const context = {
    S: { project: 'demo' }, termState: current,
    h: () => ({ replaceWith() {} }), termKeys: () => [],
    requestAnimationFrame: fn => frames.push(fn),
    document: { activeElement: { closest: () => focusedTab } },
  };
  const termView = vm.runInNewContext(`(${app.slice(start, end)})`, context);
  const view = { append() {} };
  termView(view); frames.shift()();
  assert.equal(fits, 1);
  assert.equal(focus, 0, 'the arrow-key tab selection must retain focus');
  focusedTab = false;
  termView(view); frames.shift()();
  assert.equal(focus, 1, 'mouse navigation can still focus the terminal');
  current.el.isConnected = false;
  termView(view); frames.shift()();
  assert.equal(fits, 2, 'a detached terminal must not be resized or focused');
  assert.equal(focus, 1);
});

test('mobile drawer updates its trigger and restores focus when closed', () => {
  const start = app.indexOf('const drawer = open =>');
  const end = app.indexOf('\n\n// The folder', start);
  assert.ok(start >= 0 && end > start);
  const opened = new Set();
  const calls = [];
  const context = {
    $side: {
      classList: { contains: name => opened.has(name), toggle: (name, value) => value ? opened.add(name) : opened.delete(name) },
      querySelector: () => ({ focus: () => calls.push('close focus') }),
    },
    $scrim: { classList: { toggle: (name, value) => calls.push(['scrim', value]) } },
    $main: { querySelector: () => ({ setAttribute: (...args) => calls.push(args), focus: () => calls.push('trigger focus') }) },
  };
  vm.runInNewContext(`${app.slice(start, end)}\nthis.testDrawer = drawer;`, context);
  context.testDrawer(true);
  assert.ok(opened.has('open'));
  assert.deepEqual(calls.splice(0), [['scrim', true], ['aria-expanded', 'true'], 'close focus']);
  context.testDrawer(false);
  assert.equal(opened.has('open'), false);
  assert.deepEqual(calls.splice(0), [['scrim', false], ['aria-expanded', 'false'], 'trigger focus']);
});
