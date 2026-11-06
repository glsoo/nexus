import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { QUALITY_PRESETS } from '../server/quality.js';

const source = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('chat metadata exposes the quality choices without exposing internal prompt text', () => {
  const start = source.indexOf("route('GET', '/api/projects/:name/meta'");
  const end = source.indexOf('\n});', start) + '\n});'.length;
  assert.ok(start >= 0 && end > start, 'the actual metadata route exists');
  let handler;
  vm.runInNewContext(source.slice(start, end), {
    route(method, path, run) { assert.equal(method, 'GET'); assert.equal(path, '/api/projects/:name/meta'); handler = run; },
    projects: { projectDir: () => '/fixture' }, need: name => name,
    commands: () => [], skills: () => [], agentDefs: () => [], skillScope() {}, QUALITY_PRESETS,
  });
  const result = JSON.parse(JSON.stringify(handler({ p: { name: 'fixture' } })));
  assert.deepEqual(result.qualityPresets.map(preset => preset.id), ['personal', 'shared', 'commercial']);
  for (const preset of result.qualityPresets) {
    assert.deepEqual(Object.keys(preset).sort(), ['description', 'id', 'label', 'subtitle']);
    assert.ok(preset.label && preset.subtitle && preset.description);
    assert.equal(preset.prompt, undefined);
  }
  assert.deepEqual(result.commands, []);
  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.agents, []);
});
