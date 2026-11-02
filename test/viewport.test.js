import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = app.indexOf('// Let CSS fill the screen normally;');
const end = app.indexOf('\nmarked.use(', start);
assert.ok(start >= 0 && end > start);
const source = app.slice(start, end);

function screen({ editing = false, height = 844, offsetTop = 0, visual = true } = {}) {
  const properties = new Map();
  const classes = new Set();
  const events = {};
  const visualEvents = {};
  const documentEvents = {};
  const root = {
    style: { setProperty: (k, v) => properties.set(k, v), removeProperty: k => properties.delete(k) },
    classList: { contains: k => classes.has(k), toggle: (k, on) => on ? classes.add(k) : classes.delete(k) },
  };
  const vv = { height, offsetTop, scale: 1, addEventListener: (k, fn) => { visualEvents[k] = fn; } };
  const document = {
    documentElement: root, hidden: false,
    activeElement: { matches: () => editing },
    addEventListener: (k, fn) => { documentEvents[k] = fn; },
  };
  const context = {
    window: { visualViewport: visual ? vv : undefined }, document, innerHeight: 844,
    addEventListener: (k, fn) => { events[k] = fn; }, requestAnimationFrame: fn => fn(),
    scrollTo() {}, termState: null, $log: { isConnected: true, scrollTop: 0, scrollHeight: 2000 },
  };
  vm.runInNewContext(source, context);
  return { properties, classes, events, visualEvents, documentEvents, vv, context, focus: value => { editing = value; } };
}

test('without a keyboard, CSS fills the screen instead of retaining a short pixel height', () => {
  const s = screen({ height: 500 });
  assert.equal(s.properties.has('--app-h'), false);
  assert.equal(s.properties.has('--app-top'), false);
  assert.equal(s.classes.has('kb'), false);
});

test('keyboard layout follows both visual viewport height and panning offset', () => {
  const s = screen({ editing: true, height: 380, offsetTop: 70 });
  assert.equal(s.properties.get('--app-h'), '380px');
  assert.equal(s.properties.get('--app-top'), '70px');
  assert.ok(s.classes.has('kb'));
  assert.ok(s.classes.has('short'));
  assert.equal(s.context.$log.scrollTop, 2000);
  s.vv.offsetTop = 110;
  s.visualEvents.scroll();
  assert.equal(s.properties.get('--app-top'), '110px');
});

test('blur releases keyboard height even before the visual viewport recovers', () => {
  const s = screen({ editing: true, height: 380, offsetTop: 70 });
  s.focus(false);
  s.documentEvents.focusout();
  assert.equal(s.properties.has('--app-h'), false);
  assert.equal(s.properties.has('--app-top'), false);
  assert.equal(s.classes.has('kb'), false);
  assert.equal(s.classes.has('short'), false);
});

test('keyboard dismissal and page restoration clear stale viewport overrides', () => {
  const s = screen({ editing: true, height: 380, offsetTop: 70 });
  s.vv.height = 844;
  s.vv.offsetTop = 0;
  s.visualEvents.resize();
  assert.equal(s.properties.has('--app-h'), false);
  s.properties.set('--app-h', '380px');
  s.events.pageshow();
  assert.equal(s.properties.has('--app-h'), false);
  s.properties.set('--app-h', '380px');
  s.documentEvents.visibilitychange();
  assert.equal(s.properties.has('--app-h'), false);
});

test('pinch zoom is left alone and browsers without visualViewport use CSS sizing', () => {
  const s = screen({ editing: true, height: 380 });
  s.vv.scale = 2;
  s.vv.height = 200;
  s.visualEvents.resize();
  assert.equal(s.properties.get('--app-h'), '380px');
  const fallback = screen({ visual: false });
  fallback.events.resize();
  assert.equal(fallback.properties.has('--app-h'), false);
});
