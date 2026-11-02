import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-skills-'));
process.env.HOME = tmp;
process.env.NEXUS_HOME = path.join(tmp, 'home');
const { skills } = await import('../server/extensions.js');
const cwd = path.join(tmp, 'project');
fs.mkdirSync(cwd);
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('bundled design skill is discoverable outside the Nexus repository', () => {
  const design = skills(cwd).find(s => s.name === 'design');
  assert.ok(design);
  assert.equal(design.dir, fileURLToPath(new URL('../skills/design', import.meta.url)));
  assert.match(design.description, /UI\/UX/);
  assert.equal(design.argumentHint, '[build|improve|review|logo] <request>');
  assert.match(design.usage, /\/design improve the mobile chat composer/);
  assert.match(design.body, /# Design/);
  assert.match(design.body, /hover, active, selected, focus and disabled/);
  assert.match(design.body, /black surfaces, a dark-purple accent/);
  assert.match(design.body, /browser or screenshot tooling is unavailable/);
});

test('user and project skills can override a bundled skill', () => {
  const user = path.join(process.env.NEXUS_HOME, 'skills/design');
  const project = path.join(cwd, '.nexus/skills/design');
  try {
    fs.mkdirSync(user, { recursive: true });
    fs.writeFileSync(path.join(user, 'SKILL.md'), '---\nname: design\ndescription: User design\n---\nUser instructions.');
    assert.equal(skills(cwd).find(s => s.name === 'design').body, 'User instructions.');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'SKILL.md'), '---\nname: design\ndescription: Project design\n---\nProject instructions.');
    const found = skills(cwd).filter(s => s.name === 'design');
    assert.equal(found.length, 1);
    assert.equal(found[0].body, 'Project instructions.');
  } finally {
    fs.rmSync(user, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('NEXUS_COMPAT adds another tool\'s folders only when set', () => {
  const dir = path.join(cwd, '.other/skills/shared');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: shared\ndescription: Shared\n---\nShared.');
  assert.ok(!skills(cwd).some(s => s.name === 'shared'));
  process.env.NEXUS_COMPAT = 'other';
  assert.ok(skills(cwd).some(s => s.name === 'shared'));
  delete process.env.NEXUS_COMPAT;
});
