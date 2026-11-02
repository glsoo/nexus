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

test('default sidebar keeps New and Clone spacing outside the flex buttons and touch targets intact', () => {
  assert.doesNotMatch(css, /^(?:<{7}|={7}|>{7})(?: |$)/m);
  assert.match(rule('.side .newrow'), /display: flex;/);
  assert.match(rule('.side .newrow'), /margin: 4px 12px 10px;/);
  assert.match(rule('.side .new'), /flex: 1;/);
  assert.doesNotMatch(rule('.side .new'), /\bmargin(?:-[\w-]+)?:/);
  assert.doesNotMatch(css, /\.side-label\b/);
  const touch = css.slice(css.indexOf('@media (pointer: coarse)'));
  assert.match(touch, /\.newrow \.btn\s*\{ min-width: 44px;/);
  assert.match(touch, /\.pitem > button\.open, \.found \.snip,[^{]*\{ min-height: 44px;/);
  assert.match(rule('.found .snip'), /-webkit-line-clamp: 2;/);
});

test('short drawers scroll all projects and navigation instead of clipping the controls', () => {
  const start = css.search(/@media\s*\(max-height:\s*520px\)\s*\{/);
  assert.ok(start >= 0, 'short-height drawer rules must exist');
  const short = css.slice(start, css.indexOf('\n@media', start + 1) < 0 ? undefined : css.indexOf('\n@media', start + 1));
  assert.match(short, /\.side\s*\{\s*overflow-y: auto;/);
  assert.match(short, /\.side\s*>\s*\*\s*\{\s*flex-shrink: 0;/);
  assert.match(short, /\.side \.plist\s*\{\s*flex: none;\s*overflow-y: visible;/);
});

test('default welcome and autopilot output retain their baseline layout and state colors', () => {
  assert.match(rule('.empty .row'), /display: flex; flex-wrap: wrap;/);
  assert.match(rule('.empty'), /display: grid; place-content: center;/);
  assert.match(rule('.empty h2'), /color: var\(--fg\); font-size: 18px;/);
  assert.doesNotMatch(css, /\.welcome-mark\b|\.chat-activity\b|\.loading-dot\b/);
  assert.match(rule('.cbar .apbtn.on'), /color: var\(--warn\)/);
  assert.match(rule('.tool .aptag'), /color: var\(--warn\)/);
  assert.match(rule('.tool .plan'), /border-left: 2px solid var\(--line-strong\)/);
  assert.match(rule('.e.user .itag'), /color: var\(--accent\)/);
});

test('default composer wraps controls and reorders mobile actions while hiding only inline cost', () => {
  assert.match(rule('.cbar'), /display: flex; flex-wrap: wrap;/);
  assert.match(rule('.cbox'), /background: var\(--card\); border: 1px solid var\(--line-strong\); border-radius: 12px;/);
  assert.match(rule('.cbox textarea'), /min-height: 44px;/);
  assert.match(rule('.cbar select'), /max-width: 150px; min-height: 30px;/);
  assert.doesNotMatch(css, /\.composer-(?:options|settings|setting-actions)\b|\.send-btn\b|\.stop-btn\b/);
  const mobile = css.slice(css.indexOf('@media (max-width: 760px),'), css.indexOf('@media (max-width: 760px) and (orientation: portrait)'));
  assert.match(mobile, /\.cbar \.icon-btn, \.cbar \.meter\s*\{ order: 1;/);
  assert.match(mobile, /\.cbar \.btn\s*\{ order: 2;/);
  assert.match(mobile, /\.cbar \.mcost\s*\{ display: none;/);
  assert.match(mobile, /\.cbar \.abtn\s*\{ flex: 1 1 24%;/);
  assert.match(mobile, /\.cbar \.mbtn:not\(\.abtn\)\s*\{ flex-basis: 38%;/);
  assert.match(css, /\.short \.cbar select, \.short \.cbar \.mbtn, \.short \.cbar \.meter\s*\{ display: none;/);
});

test('inline autopilot state retains its warning treatment and survives forced colors', () => {
  const indicator = rule('.cbar .apbtn.on');
  assert.match(indicator, /color: var\(--warn\)/);
  assert.match(indicator, /background: color-mix\(in srgb, var\(--warn\)/);
  assert.match(indicator, /box-shadow:/);
  const forcedStart = css.indexOf('@media (forced-colors: active)');
  assert.ok(forcedStart >= 0, 'forced colors must preserve the active autopilot outline');
  const forced = css.slice(forcedStart);
  assert.match(forced, /\.cbar \.apbtn\.on\s*\{\s*outline: 1px solid ButtonText;/);
});

test('default CSS retains drawer dismissal and reduced-motion pseudo-element coverage', () => {
  assert.match(rule('.side-close'), /display: none;/);
  const mobile = css.slice(css.indexOf('@media (max-width: 760px),'), css.indexOf('@media (max-width: 760px) and (orientation: portrait)'));
  assert.match(mobile, /\.side-close\s*\{ display: inline-grid;/);
  const reducedStart = css.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reducedStart >= 0, 'reduced-motion support must exist');
  const reduced = css.slice(reducedStart);
  assert.match(reduced, /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{\s*animation: none !important;\s*transition: none !important;/);
});
