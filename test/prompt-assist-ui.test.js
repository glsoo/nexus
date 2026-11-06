import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = app.indexOf("  const enhance = h('button'");
const end = app.indexOf('\n  $stopBtn =', start);
assert.ok(start >= 0 && end > start, 'actual enhancer control is available');
const code = `(() => { ${app.slice(start, end)}; return enhance; })()`;
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(quality = 'personal') {
  const requests = [], toasts = [];
  const input = { value: 'A rough idea', isConnected: true, focus() {} };
  let resolve, reject;
  const context = vm.createContext({
    h: (tag, props, ...children) => ({ tag, ...props, children }), icon: name => ({ name }), guard: fn => fn,
    S: { project: 'demo', state: { quality, gen: 3 }, meta: { qualityPresets: ['personal', 'shared', 'commercial'].map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) })) } },
    $input: input, drafts: { demo: input.value }, P: name => `/api/projects/${name}`,
    grow() {}, toast: (...args) => { toasts.push(args); },
    api: (method, url, data) => { requests.push({ method, url, data: JSON.parse(JSON.stringify(data)) }); return new Promise((yes, no) => { resolve = yes; reject = no; }); },
    send() { throw new Error('Prompt assistance must never send the chat'); },
  });
  const button = vm.runInContext(code, context);
  return { context, input, button, requests, toasts, resolve: value => resolve(value), reject: error => reject(error) };
}

test('AI prompt help sends the selected level and stays a draft until the user sends it', async () => {
  for (const quality of ['personal', 'shared', 'commercial']) {
    const f = fixture(quality), work = f.button.onclick();
    assert.equal(f.button.disabled, true);
    assert.deepEqual(f.requests, [{ method: 'POST', url: '/api/projects/demo/enhance', data: { text: 'A rough idea', quality } }]);
    assert.equal(f.input.value, 'A rough idea');
    f.resolve({ text: `A ${quality} prompt`, quality });
    await work;
    assert.equal(f.input.value, `A ${quality} prompt`);
    assert.equal(f.context.drafts.demo, f.input.value);
    assert.equal(f.context.S.state.quality, quality);
    assert.equal(f.button.disabled, false);
    assert.match(f.toasts.at(-1)[0], new RegExp(quality, 'i'));
    const undo = f.toasts.at(-1)[1];
    assert.equal(undo[0], 'Undo');
    undo[1]();
    assert.equal(f.input.value, 'A rough idea');
    assert.equal(f.context.drafts.demo, 'A rough idea');
  }
});

test('typing while prompt assistance is pending never loses the newer draft', async () => {
  const f = fixture('shared'), work = f.button.onclick();
  f.input.value = f.context.drafts.demo = 'My newer edits';
  f.resolve({ text: 'An old rewrite', quality: 'shared' });
  await work;
  assert.equal(f.input.value, 'My newer edits');
  assert.equal(f.context.drafts.demo, 'My newer edits');
});

test('late responses cannot overwrite another chat, a replaced input or a newer generation', async () => {
  for (const change of ['chat', 'input', 'generation', 'level']) {
    const f = fixture('personal'), work = f.button.onclick();
    if (change === 'chat') { f.context.S.project = 'other'; f.context.drafts.other = 'Other chat'; }
    if (change === 'input') { f.input.isConnected = false; f.context.$input = { value: 'Other input', isConnected: true, focus() {} }; }
    if (change === 'generation') f.context.S.state.gen++;
    if (change === 'level') f.context.S.state.quality = 'commercial';
    const current = f.context.$input.value;
    f.resolve({ text: 'A late old rewrite', quality: 'personal' });
    await work;
    assert.equal(f.context.$input.value, current, change);
    assert.equal(f.context.drafts.demo, 'A rough idea', change);
    if (change === 'chat') assert.equal(f.context.drafts.other, 'Other chat');
  }
});

test('mismatched or invalid helper responses cannot replace the draft', async () => {
  for (const response of [{ text: 'Wrong level', quality: 'personal' }, { text: ' ', quality: 'shared' }, { text: 123, quality: 'shared' }, { text: 'Legacy response' }]) {
    const f = fixture('shared'), work = f.button.onclick();
    f.resolve(response);
    await assert.rejects(work);
    assert.equal(f.input.value, 'A rough idea');
    assert.equal(f.context.drafts.demo, 'A rough idea');
    assert.equal(f.button.disabled, false);
  }
});

test('Undo only restores the matching draft in its original chat', async () => {
  for (const change of ['typing', 'chat', 'input', 'generation']) {
    const f = fixture('commercial'), work = f.button.onclick();
    f.resolve({ text: 'Commercial rewrite', quality: 'commercial' });
    await work;
    const undo = f.toasts.at(-1)[1][1];
    if (change === 'typing') f.input.value = f.context.drafts.demo = 'Later edit';
    if (change === 'chat') { f.context.S.project = 'other'; f.context.drafts.other = 'Other draft'; }
    if (change === 'input') { f.input.isConnected = false; f.context.$input = { value: 'Recreated input', isConnected: true, focus() {} }; }
    if (change === 'generation') f.context.S.state.gen++;
    const current = f.context.$input.value;
    undo();
    assert.equal(f.context.$input.value, current, change);
    if (change === 'chat') assert.equal(f.context.drafts.other, 'Other draft');
  }
});

test('actual status events invalidate a pre-compaction rewrite and its Undo', async () => {
  const agent = fs.readFileSync(new URL('../server/agent.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const emitStart = agent.indexOf('const status =');
  const emitEnd = agent.indexOf('\nconst send =', emitStart);
  const receiveStart = app.indexOf("    case 'status': {");
  const receiveEnd = app.indexOf("\n    case 'reset':", receiveStart);
  assert.ok(emitStart >= 0 && emitEnd > emitStart && receiveStart >= 0 && receiveEnd > receiveStart);
  for (const phase of ['pending', 'undo']) {
    const f = fixture('shared'), work = f.button.onclick();
    const hub = new EventEmitter();
    const sender = vm.createContext({ hub, compactAt: () => 300000, qualityPreset: id => ({ id }) });
    vm.runInContext(`${agent.slice(emitStart, emitEnd)}\nthis.emitStatus = status;`, sender);
    Object.assign(f.context, { finished() {}, refreshReview() {}, filesChanged() {}, syncTitle() {}, syncComposer() {}, $review: null });
    vm.runInContext(`this.receiveStatus = m => { switch (m.t) { ${app.slice(receiveStart, receiveEnd)} } };`, f.context);
    hub.on('project', (name, event) => { assert.equal(name, 'demo'); f.context.receiveStatus(event); });
    const server = { name: 'demo', state: { quality: 'shared', gen: 3, running: false } };
    if (phase === 'undo') { f.resolve({ text: 'Shared rewrite', quality: 'shared' }); await work; }
    server.state.gen = 4;
    sender.emitStatus(server);
    assert.equal(f.context.S.state.gen, 4, 'the real sender and receiver must synchronize the generation');
    const current = f.input.value;
    if (phase === 'pending') { f.resolve({ text: 'A stale rewrite', quality: 'shared' }); await work; }
    else f.toasts.at(-1)[1][1]();
    assert.equal(f.input.value, current, phase);
  }
});

test('failure preserves the original draft and re-enables assistance; blank ideas do not call AI', async () => {
  const f = fixture('shared'), work = f.button.onclick();
  f.reject(new Error('Fixture provider unavailable'));
  await assert.rejects(work, /Fixture provider unavailable/);
  assert.equal(f.input.value, 'A rough idea');
  assert.equal(f.button.disabled, false);
  const blank = fixture(); blank.input.value = '  ';
  await blank.button.onclick(); await tick();
  assert.equal(blank.requests.length, 0);
});
