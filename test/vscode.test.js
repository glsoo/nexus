import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Every place an editor's settings could be is inside this temp folder, so the real VS Code settings are never read.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-vscode-'));
process.env.HOME = tmp;
process.env.APPDATA = path.join(tmp, 'appdata');
process.env.XDG_CONFIG_HOME = path.join(tmp, 'config');
const { editors, parseJsonc, terminalRules } = await import('../server/vscode.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const base = process.platform === 'win32' ? process.env.APPDATA : process.platform === 'darwin' ? path.join(tmp, 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME;

test('parseJsonc reads comments and trailing commas but leaves strings alone', () => {
  assert.deepEqual(parseJsonc('{\n  // a comment\n  "url": "https://x.dev/a//b", /* block */ "s": "a,}", "list": [1, 2,],\n  "q": "say \\"hi\\" // not a comment",\n}'),
    { url: 'https://x.dev/a//b', s: 'a,}', list: [1, 2], q: 'say "hi" // not a comment' });
});

test("VS Code's terminal approval rules come in as allow and ask", () => {
  assert.deepEqual(terminalRules(), []);
  const user = path.join(base, 'Code', 'User');
  fs.mkdirSync(user, { recursive: true });
  fs.writeFileSync(path.join(user, 'settings.json'), `{
    // mine
    "editor.fontSize": 14,
    "chat.tools.terminal.autoApprove": {
      "npm test": true,
      "/^git (status|diff)\\\\b/": true,
      "rm": false,
      "git push": { "approve": false, "matchCommandLine": true },
      "ignored": null,
    },
  }`);
  assert.deepEqual(editors().map(e => e.app), ['VS Code']);
  const [vs] = terminalRules();
  assert.equal(vs.app, 'VS Code');
  assert.deepEqual(vs.commands, { 'npm test': 'allow', '/^git (status|diff)\\b/': 'allow', rm: 'ask', 'git push': 'ask' });
});
