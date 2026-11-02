import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const makeNode = (tag, props = {}, ...kids) => {
  const el = { tag, ...props, children: [] };
  for (const child of kids.flat(Infinity).filter(c => c !== false && c != null)) {
    if (typeof child === 'object') {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
      child.parent = el;
    }
    el.children.push(child);
  }
  return el;
};
const find = (el, predicate) => typeof el !== 'object' ? [] : [
  ...(predicate(el) ? [el] : []), ...el.children.flatMap(child => find(child, predicate)),
];
const hasClass = (el, name) => el.class?.split(' ').includes(name);

test('merged composer keeps all settings in the disclosure and dictation on the compact row', () => {
  const start = app.indexOf('function composer()');
  const end = app.indexOf('\nconst EFFORTS', start);
  assert.ok(start >= 0 && end > start);
  for (const Speech of [undefined, function Speech() {}]) {
    const context = {
      h: makeNode, icon: name => makeNode('svg', { name }), guard: fn => fn,
      S: { project: 'demo' }, drafts: {}, MODES: [['default', 'Ask first']], Speech,
      setMode() {}, toggleAutopilot() {}, agentPicker() {}, promptsDialog() {}, modelPicker() {},
      tokenPanel() {}, send() {}, syncThumbs() {},
    };
    const composer = vm.runInNewContext(`(${app.slice(start, end)})`, context)();
    const options = find(composer, el => hasClass(el, 'composer-options'))[0];
    const bar = find(composer, el => hasClass(el, 'cbar'))[0];
    for (const control of ['$mode', '$autoBtn', '$agentBtn', '$promptBtn', '$meter']) {
      assert.equal(find(options, el => el === context[control]).length, 1, `${control} must remain inside settings`);
      assert.equal(bar.children.includes(context[control]), false, `${control} must not be moved onto the main row`);
    }
    assert.equal(context.$autoBtn.children.at(-1), 'Autopilot', 'autopilot needs a visible text label');
    assert.equal(hasClass(context.$autoBtn, 'btn'), true, 'autopilot uses a full-size settings button');
    for (const control of ['$model', '$stopBtn', '$sendBtn']) assert.ok(bar.children.includes(context[control]));
    assert.equal(find(bar, el => el['aria-label'] === 'Dictate').length, Speech ? 1 : 0);
    assert.equal(find(bar, el => hasClass(el, 'cbar')).length, 1);
  }
});

test('review autocomplete exposes skill help and branch/PR routing instead of the old built-in hint', () => {
  const start = app.indexOf('const BUILTIN =');
  const end = app.indexOf('\nfunction localCommand', start);
  assert.ok(start >= 0 && end > start);
  const hint = '<target> | branch [base] | <PR number|URL>';
  const items = vm.runInNewContext(`${app.slice(start, end)}\nslashItems()`, {
    S: { meta: { commands: [], skills: [{ name: 'review', description: 'Read-only review', argumentHint: hint }] } },
  });
  const review = items.filter(item => item.name === 'review');
  assert.equal(review.length, 1);
  assert.equal(review[0].argumentHint, hint);
});

test('scheduled review guidance uses the branch command rather than no-argument help', () => {
  assert.match(app, /Nothing scheduled\. In a chat, \/schedule 0 9 \* \* 1-5 \/review branch reviews that branch every weekday at 9\./);
  assert.doesNotMatch(app, /\/schedule 0 9 \* \* 1-5 \/review reviews/);
});

test('merged sidebar keeps clone, search, marketplace and the accessible drawer close button', () => {
  const start = app.indexOf('function shell()');
  const end = app.indexOf('\nconst drawer', start);
  assert.ok(start >= 0 && end > start);
  let shell;
  const context = {
    h: makeNode, icon: name => makeNode('svg', { name }), guard: fn => fn,
    $app: { replaceChildren: el => { shell = el; } }, newProject() {}, cloneDialog() {},
  };
  vm.runInNewContext(`(${app.slice(start, end)})`, context)();
  const side = find(shell, el => el.tag === 'aside')[0];
  assert.equal(side.id, 'workspace-sidebar');
  assert.equal(side['aria-label'], 'Workspace');
  assert.equal(find(side, el => el['aria-label'] === 'Close menu').length, 1);
  assert.equal(find(side, el => el['aria-label'] === 'Search chats').length, 1);
  assert.equal(find(side, el => el.id === 'nav-market').length, 1);
  const row = find(side, el => hasClass(el, 'newrow'))[0];
  assert.equal(find(row, el => el.tag === 'button').length, 2);
  assert.equal(find(row, el => el['aria-label'] === 'Clone a git repository').length, 1);
  assert.equal(find(side, el => hasClass(el, 'side-label'))[0].children[0], 'Projects');
});
