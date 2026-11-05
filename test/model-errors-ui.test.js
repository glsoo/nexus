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
const find = (el, predicate) => !el || typeof el !== 'object' ? [] : [
  ...(predicate(el) ? [el] : []), ...(el.children || []).flatMap(child => find(child, predicate)),
];
const hasClass = (el, name) => el.className?.split(' ').includes(name);
function element(tag) {
  const el = {
    tag, children: [], events: {}, className: '', value: '', disabled: false,
    setAttribute(k, v) { this[k] = v; },
    addEventListener(k, fn) { (this.events[k] ||= []).push(fn); },
    append(...kids) {
      for (const child of kids) {
        if (typeof child === 'object') child.parent = this;
        this.children.push(child);
      }
    },
    replaceChildren(...kids) { this.children = []; this.append(...kids); },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); },
    showModal() { this.open = true; },
    close() { this.open = false; for (const fn of this.events.close || []) fn(); },
    focus() {},
    get textContent() { return this.children.map(c => typeof c === 'object' ? c.textContent : String(c)).join(''); },
    set textContent(v) { this.children = [v]; },
    set innerHTML(_) { throw new Error('Diagnostics must not use innerHTML'); },
  };
  el.classList = { add: name => { el.className += ` ${name}`; } };
  return el;
}
const click = el => el.events.click[0]({ currentTarget: el });
const tick = () => new Promise(resolve => setImmediate(resolve));
function helpers(extra = {}) {
  const body = element('body'), toasts = [], copies = [];
  const context = vm.createContext({
    document: { body, createElement: element },
    navigator: { clipboard: { writeText: async text => { copies.push(text); } } },
    toast: text => { toasts.push(text); }, exit: async () => {},
    ...extra,
  });
  vm.runInContext([
    part('function h(', '\nconst ICONS'),
    part('async function api(', '\nconst P ='),
    part('const guard =', '\nfunction markdown'),
    part('async function copyText(', '\nconst copyButton'),
    part('function dialog(', '\nconst confirmBox'),
    'this.api = api; this.guard = guard;',
  ].join('\n'), context);
  return { context, body, toasts, copies };
}
const diagnostic = 'OpenAI HTTP 401: <img src=x onerror=alert(1)> invalid key\ncode: invalid_api_key\nrequest id: req_test\nCause: ECONNRESET';

test('api preserves provider diagnostics without signing out; a real Nexus 401 still signs in', async () => {
  let logins = 0;
  const { context } = helpers({ showLogin: () => { logins++; } });
  for (const status of [502, 401]) {
    context.fetch = async () => ({ status, ok: false, json: async () => ({ error: diagnostic, provider: 'OpenAI' }) });
    await assert.rejects(context.api('POST', '/api/projects/demo/enhance', {}), err => err.message === diagnostic && err.provider === 'OpenAI');
    assert.equal(logins, 0, 'an upstream authentication error is not a Nexus logout');
  }
  context.fetch = async () => ({ status: 401, ok: false, json: async () => ({ error: 'Sign in first.' }) });
  await assert.rejects(context.api('GET', '/api/projects'), /Signed out/);
  assert.equal(logins, 1);
  await assert.rejects(context.api('POST', '/api/login', {}), /Sign in first/);
  assert.equal(logins, 1, 'a bad login does not restart the login form');
});

test('guard keeps the full AI diagnostic as plain text in a Copy/Close dialog; ordinary errors toast', async () => {
  const { context, body, toasts, copies } = helpers();
  const failure = Object.assign(new Error(diagnostic), { provider: 'OpenAI' });
  const pending = context.guard(async () => { throw failure; })();
  await tick();
  const d = find(body, el => el.tag === 'dialog')[0];
  assert.ok(d?.open, 'AI failures remain visible until dismissed');
  const alert = find(d, el => el.role === 'alert')[0];
  assert.equal(alert.textContent, diagnostic);
  assert.equal(alert.children.length, 1, 'provider HTML is one literal text child');
  assert.equal(find(alert, el => el.tag === 'img').length, 0);
  assert.equal(toasts.length, 0);
  await click(find(d, el => el.tag === 'button' && el.textContent === 'Copy')[0]);
  assert.deepEqual(copies, [diagnostic]);
  assert.equal(d.open, true, 'copying does not dismiss the diagnostic');
  await click(find(d, el => el.tag === 'button' && el.textContent === 'Close')[0]);
  await pending;
  assert.equal(find(body, el => el.tag === 'dialog').length, 0);
  await context.guard(async () => { throw new Error('Project not found.'); })();
  assert.equal(toasts.at(-1), 'Project not found.');
});

test('prompt enhancement keeps the original draft and presents the full request failure', async () => {
  const { context, body } = helpers({
    S: { project: 'demo' }, drafts: { demo: 'Keep this draft' }, Speech: undefined,
    icon: () => element('svg'), setMode() {}, toggleAutopilot() {}, agentPicker() {}, promptsDialog() {},
    modelPicker() {}, tokenPanel() {}, send() {}, syncThumbs() {},
    fetch: async () => ({ status: 502, ok: false, json: async () => ({ provider: 'OpenAI', error: diagnostic }) }),
  });
  vm.runInContext(`${part('const P =', '\n// Motion')}\n${part('function composer()', '\nconst EFFORTS')}\nthis.composer = composer;`, context);
  const composer = context.composer();
  const enhance = find(composer, el => el['aria-label'] === 'Improve this prompt')[0];
  const pending = click(enhance);
  await tick();
  assert.equal(context.$input.value, 'Keep this draft');
  assert.equal(enhance.disabled, false);
  const d = find(body, el => el.tag === 'dialog')[0];
  assert.equal(find(d, el => el.role === 'alert')[0].textContent, diagnostic);
  await click(find(d, el => el.tag === 'button' && el.textContent === 'Close')[0]);
  await pending;
});

test('AI commit messages show the full diagnostic above the existing source-control dialog', async () => {
  const { context, body } = helpers({
    S: { project: 'demo' }, icon: () => element('svg'),
    fetch: async url => url.endsWith('/git/message')
      ? { status: 502, ok: false, json: async () => ({ provider: 'OpenAI', error: diagnostic }) }
      : { status: 200, ok: true, json: async () => ({ repo: true, files: [{ status: 'M', path: 'test.js' }], branches: ['dev'], branch: 'dev', log: [] }) },
  });
  vm.runInContext(`${part('const P =', '\n// Motion')}\n${part('const GIT_STATUS =', '\n// ---- terminal')}\nthis.gitDialog = gitDialog;`, context);
  await context.gitDialog();
  const sourceControl = find(body, el => el.tag === 'dialog')[0];
  const write = find(sourceControl, el => el.tag === 'button' && el.textContent === 'Write it with AI')[0];
  const pending = click(write);
  await tick();
  assert.equal(write.disabled, false);
  const d = find(body, el => el.tag === 'dialog').at(-1);
  assert.notEqual(d, sourceControl);
  assert.equal(find(d, el => el.role === 'alert')[0].textContent, diagnostic);
  await click(find(d, el => el.tag === 'button' && el.textContent === 'Close')[0]);
  await pending;
  assert.equal(sourceControl.open, true, 'the source-control dialog stays usable');
});

function modelSettings(extra = {}) {
  const calls = [], { context, body, toasts } = helpers({
    S: { models: [] }, uid: () => 'test-key', syncComposer() {}, render() {},
    extLink: label => label,
    ...extra,
  });
  const keys = [{ name: 'OPENAI_API_KEY', saved: true }, { name: 'GROQ_API_KEY', saved: true }, { name: 'GEMINI_API_KEY' }];
  const models = [{ id: 'groq:good-model', provider: 'groq', providerName: 'Groq' }];
  context.fetch = async (url, init) => {
    calls.push([init.method, url]);
    const result = url === '/api/keys' ? keys : url.startsWith('/api/models') ? {
      models, errors: [{ provider: 'openai', error: diagnostic }, { provider: 'ollama', error: 'Ollama connection refused\nCause: ECONNREFUSED' }],
    } : {};
    return { status: 200, ok: true, json: async () => result };
  };
  vm.runInContext(`${part('const KEY_INFO =', '\nasync function spendCard')}\nthis.modelsCard = modelsCard;`, context);
  return { context, body, toasts, calls, keys, models };
}

test('model rows show the exact provider reason and keep healthy models; local failures stay collapsed', async () => {
  const { context, calls, models } = modelSettings();
  const card = element('section'); card.append(...await context.modelsCard());
  assert.ok(calls.some(([, url]) => url === '/api/models?details=1'));
  assert.equal(context.S.models[0].id, models[0].id);
  const rows = find(card, el => hasClass(el, 'keyrow'));
  const openai = rows.find(el => el.textContent.includes('OpenAI'));
  assert.ok(openai.textContent.includes(diagnostic));
  assert.ok(find(openai, el => el.role === 'alert' && el.textContent === diagnostic).length);
  assert.ok(rows.find(el => el.textContent.includes('Groq')).textContent.includes('Connected · 1 models'));
  const gemini = rows.find(el => el.textContent.includes('Google Gemini'));
  assert.ok(gemini.textContent.includes('Not set'));
  assert.equal(find(gemini, el => el.role === 'alert').length, 0, 'no warning for an unconfigured provider');
  const details = find(card, el => el.tag === 'details')[0];
  assert.ok(details.textContent.includes('Ollama connection refused\nCause: ECONNREFUSED'));
  assert.ok(!details.open, 'local servers that are not running do not raise a global chat alarm');
});

test('saving a rejected key refreshes details and reports the actual failure, not a generic check-key toast', async () => {
  const { context, calls, body, toasts, keys } = modelSettings();
  keys[0].saved = false;
  const card = element('section'); card.append(...await context.modelsCard());
  const row = find(card, el => hasClass(el, 'keyrow') && el.textContent.includes('OpenAI'))[0];
  find(row, el => el.tag === 'input')[0].value = 'synthetic-test-key';
  const pending = click(find(row, el => el.tag === 'button' && el.textContent === 'Save')[0]);
  await tick();
  assert.ok(calls.some(([method, url]) => method === 'PUT' && url === '/api/keys/OPENAI_API_KEY'));
  assert.equal(calls.filter(([, url]) => url === '/api/models?details=1').length, 2);
  assert.ok(toasts.some(text => /saved/i.test(text)), 'the user knows the key was stored');
  assert.ok(!toasts.some(text => /check the key/i.test(text)));
  const d = find(body, el => el.tag === 'dialog')[0];
  assert.equal(find(d, el => el.role === 'alert')[0].textContent, diagnostic);
  await click(find(d, el => el.tag === 'button' && el.textContent === 'Close')[0]);
  await pending;
});

test('browser OS error notifications respect notifyErrors without hiding the UI failure', () => {
  for (const allowed of [false, true]) {
    const notifications = [], S = { alerts: {}, project: 'visible', page: null, tab: 'chat', me: {} };
    function Notification(title, options) { notifications.push({ title, ...options }); }
    Notification.permission = 'granted';
    const context = { S, document: { hidden: true }, window: { Notification }, Notification,
      pretty: p => p, refreshSoon() {}, syncTitle() {}, pref: () => '1', focus() {}, go() {} };
    const notice = vm.runInNewContext(`(${part('function notice(', '\n// Web Push')})`, context);
    notice({ project: 'failed-chat', kind: 'error', body: diagnostic, notify: allowed });
    assert.equal(S.alerts['failed-chat'], 'error');
    assert.equal(notifications.length, allowed ? 1 : 0);
    notice({ project: 'successful-chat', kind: 'finished', body: 'Done.' });
    assert.equal(notifications.length, allowed ? 2 : 1, 'successful notification behavior is unchanged');
  }
});

test('chat errors preserve multiline diagnostics and long unbroken messages wrap', () => {
  const entry = /\.e\.error\s*\{([^}]+)\}/.exec(css)?.[1];
  assert.match(entry, /white-space:\s*pre-wrap/);
  assert.match(entry, /overflow-wrap:\s*anywhere/);
  const alert = /\.err\s*\{([^}]+)\}/.exec(css)?.[1];
  assert.match(alert, /white-space:\s*pre-wrap/);
  assert.match(alert, /overflow-wrap:\s*anywhere/);
});
