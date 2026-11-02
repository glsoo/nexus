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

test('default composer keeps every control inline exactly once with optional dictation and text actions', () => {
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
    const bars = find(composer, el => hasClass(el, 'cbar'));
    assert.equal(bars.length, 1);
    const bar = bars[0];
    const controls = ['$mode', '$autoBtn', '$agentBtn', '$model', '$promptBtn', '$meter', '$stopBtn', '$sendBtn'];
    let previous = -1;
    for (const control of controls) {
      assert.ok(context[control], `${control} must exist`);
      assert.equal(find(composer, el => el === context[control]).length, 1, `${control} must appear exactly once`);
      const index = bar.children.indexOf(context[control]);
      assert.ok(index > previous, `${control} must be a direct child in the default control order`);
      previous = index;
    }
    assert.equal(find(composer, el => hasClass(el, 'composer-options') || hasClass(el, 'composer-settings')).length, 0);
    for (const control of ['$autoBtn', '$promptBtn']) {
      assert.equal(hasClass(context[control], 'icon-btn'), true);
      assert.equal(hasClass(context[control], 'btn'), false);
      assert.equal(context[control].children.length, 1);
      assert.equal(context[control].children[0].tag, 'svg');
      assert.ok(context[control]['aria-label'], `${control} needs an accessible icon label`);
    }
    for (const [control, label] of [['$sendBtn', 'Send'], ['$stopBtn', 'Stop']]) {
      assert.equal(hasClass(context[control], 'btn'), true);
      assert.equal(hasClass(context[control], 'small'), true);
      assert.deepEqual(context[control].children, [label]);
    }
    assert.equal(context.$stopBtn.hidden, true);
    assert.equal(context.$mode['aria-label'], 'Permission mode');
    assert.equal(context.$autoBtn['aria-label'], 'Autopilot');
    assert.equal(context.$promptBtn['aria-label'], 'System prompts and injected text');
    const microphones = find(composer, el => el['aria-label'] === 'Dictate');
    assert.equal(microphones.length, Speech ? 1 : 0);
    if (Speech) assert.ok(bar.children.includes(microphones[0]), 'dictation stays on the inline bar');
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
  assert.equal(find(side, el => hasClass(el, 'side-label')).length, 0, 'the default sidebar has no custom Projects heading');
  const projects = find(side, el => hasClass(el, 'plist'));
  assert.equal(projects.length, 1);
  assert.equal(projects[0]['aria-label'], 'Projects', 'project navigation keeps its accessible name');
});
