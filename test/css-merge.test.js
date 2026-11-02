import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const rule = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `Missing ${selector} rule`);
  return match[1];
};

test('merged sidebar keeps glass spacing around New and Clone, not inside the flex row', () => {
  assert.doesNotMatch(css, /^(?:<{7}|={7}|>{7})(?: |$)/m);
  assert.match(rule('.side .newrow'), /display: flex;/);
  assert.match(rule('.side .newrow'), /margin: 0 14px 22px;/);
  assert.match(rule('.side .new'), /flex: 1;/);
  assert.match(rule('.side .new'), /color: var\(--accent-text\)/);
  assert.doesNotMatch(rule('.side .new'), /\bmargin(?:-[\w-]+)?:/);
  const touch = css.slice(css.indexOf('@media (pointer: coarse)'));
  assert.match(touch, /\.newrow \.btn\s*\{ min-width: 44px;/);
  assert.match(touch, /\.pitem > button\.open, \.found \.snip,[^{]*\{ min-height: 44px;/);
  assert.match(rule('.found .snip'), /-webkit-line-clamp: 2;/);
});

test('short drawers scroll all projects and navigation instead of clipping the new controls', () => {
  const short = css.slice(css.indexOf('@media (max-height: 520px) {'), css.indexOf('@media (max-width: 760px) and (orientation: portrait)'));
  assert.match(short, /\.side\s*\{ overflow-y: auto;/);
  assert.match(short, /\.side > \*\s*\{ flex-shrink: 0;/);
  assert.match(short, /\.side \.plist\s*\{ flex: none; overflow-y: visible;/);
});

test('welcome actions and autopilot output styles coexist with readable purple tags', () => {
  assert.match(rule('.empty .row'), /display: flex; flex-wrap: wrap;/);
  assert.match(rule('.empty'), /justify-items: center;/);
  assert.match(rule('.welcome-mark'), /var\(--glass-solid\)/);
  assert.match(rule('.cbar .apbtn.on'), /color: var\(--warn\)/);
  assert.match(rule('.tool .aptag'), /color: var\(--warn\)/);
  assert.match(rule('.tool .plan'), /border-left: 2px solid var\(--line-strong\)/);
  assert.match(rule('.e.user .itag'), /color: var\(--accent-text\)/);
});

test('merged composer stays compact without reordering controls or hiding settings cost', () => {
  assert.match(rule('.cbar'), /flex-wrap: nowrap;/);
  assert.match(rule('.composer-settings'), /position: absolute;/);
  assert.match(rule('.composer-setting-actions'), /flex-wrap: wrap;/);
  assert.doesNotMatch(css, /\.cbar[^{}]*\{[^}]*\border:/);
  assert.doesNotMatch(css, /\.cbar\s+\.mcost\s*\{[^}]*display: none/);
  assert.doesNotMatch(css, /\.short \.cbar/);
  assert.doesNotMatch(css, /\.cbar select\s*\{/);
});

test('autopilot status fits the existing summary target and survives forced colors', () => {
  const indicator = rule('.composer-options-toggle.autopilot::after');
  assert.match(indicator, /position: absolute;/);
  assert.match(indicator, /var\(--control-inset\)/);
  assert.match(indicator, /width: 6px; height: 6px;/);
  assert.match(indicator, /background: var\(--warn\)/);
  assert.match(indicator, /pointer-events: none;/);
  const forced = css.slice(css.indexOf('@media (forced-colors: active)'));
  assert.match(forced, /\.composer-options-toggle\.autopilot::after\s*\{[^}]*background: Highlight; border-color: ButtonText;/);
  assert.match(forced, /\.cbar \.apbtn\.on\s*\{ outline: 1px solid ButtonText;/);
});

test('merged CSS retains drawer dismissal and reduced-motion pseudo-element coverage', () => {
  assert.match(rule('.side-close'), /display: none;/);
  assert.match(css, /\.side-close\s*\{ display: inline-grid;/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\)/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\*, \*::before, \*::after\s*\{ animation: none !important; transition: none !important;/);
});
