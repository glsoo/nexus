import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('chat loading status is readable, decorative to assistive tech, and outside the compact message bar', () => {
  const start = app.indexOf('function chatView(');
  const end = app.indexOf('\nlet following', start);
  assert.ok(start >= 0 && end > start);
  const h = (tag, props, ...children) => ({
    tag, ...props, children: children.flat(Infinity),
    addEventListener() {}, append(...kids) { this.children.push(...kids); },
  });
  const context = {
    h, entries: new Map(), S: { state: { log: [] }, project: 'fixture' },
    stopFollow() {}, composer: () => h('div', { class: 'composer' }), syncComposer() {},
    matchMedia: () => ({ matches: false }),
  };
  const view = h('div', {});
  vm.runInNewContext(`(${app.slice(start, end)})`, context)(view);
  const activity = context.$activity;
  assert.equal(activity.class, 'chat-activity');
  assert.equal(activity.role, 'status');
  assert.equal(activity['aria-live'], 'polite');
  assert.equal(activity['aria-atomic'], 'true');
  assert.equal(activity.hidden, true, 'starts hidden until real session state is synchronized');
  assert.equal(activity.children[0].class, 'loading-dot');
  assert.equal(activity.children[0]['aria-hidden'], 'true', 'the animated decoration is not a second announcement');
  assert.equal(activity.children[1], 'Working…', 'loading is not communicated by color alone');
  assert.equal(view.children[2], activity);
  assert.equal(view.children[3].class, 'composer');
  assert.equal(context.$log.children.includes(activity), false, 'do not duplicate status announcements inside the live chat log');
});

test('loading glow uses purple tokens and bounded, reduced-motion-safe animations', () => {
  assert.match(css, /\.loading-dot\s*\{[^}]*background: var\(--accent-text\);[^}]*box-shadow: 0 0 8px var\(--accent\), 0 0 16px var\(--accent\)/);
  const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'), css.indexOf('@keyframes composer-in'));
  assert.match(motion, /\.chat-activity:not\(\[hidden\]\) \.loading-dot\s*\{ animation: loading-breathe 1\.8s/);
  assert.match(motion, /\.chat-activity:not\(\[hidden\]\) \.loading-dot::before\s*\{ animation: loading-ring 1\.8s/);
  for (const name of ['loading-breathe', 'loading-ring']) {
    const keyframes = css.slice(css.indexOf(`@keyframes ${name}`)).split('\n')[0];
    assert.match(keyframes, /opacity:/);
    assert.match(keyframes, /transform: scale/);
    assert.doesNotMatch(keyframes, /box-shadow:|width:|height:|filter:/, 'only opacity and transform animate');
  }
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\*, \*::before, \*::after\s*\{ animation: none !important/);
  const forced = css.slice(css.indexOf('@media (forced-colors: active)'));
  assert.match(forced, /\.loading-dot\s*\{ background: Highlight; box-shadow: none; forced-color-adjust: none;/);
});
