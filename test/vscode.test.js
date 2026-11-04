import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Every place an editor's settings could be is inside this temp folder, so the real VS Code settings are never read.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-vscode-'));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp; // the home folder on Windows
process.env.NEXUS_HOME = path.join(tmp, 'nexus');
process.env.APPDATA = path.join(tmp, 'appdata');
process.env.XDG_CONFIG_HOME = path.join(tmp, 'config');
const { editors, parseJsonc, terminalRules } = await import('../server/vscode.js');
const market = await import('../server/market.js');
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

test('MCP servers set up in VS Code, Cursor and the project show up to install, with VS Code inputs as fields', async () => {
  const user = path.join(base, 'Code', 'User');
  fs.mkdirSync(user, { recursive: true });
  fs.writeFileSync(path.join(user, 'mcp.json'), JSON.stringify({
    servers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ${input:gh}' } } },
    inputs: [{ type: 'promptString', id: 'gh', description: 'GitHub token', password: true }],
  }));
  fs.mkdirSync(path.join(tmp, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.cursor', 'mcp.json'), '{ "mcpServers": { "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"], }, }, }');
  const cwd = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(cwd, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.vscode', 'mcp.json'), JSON.stringify({ servers: { files: { command: 'node', args: ['${workspaceFolder}/mcp.js'], env: { KEY: '${input:key}', MODE: 'dev' } } } }));

  const items = await market.search('mcp', 'vscode', '', cwd);
  assert.deepEqual(items.map(i => i.id).sort(), ['Cursor:memory', 'This project:files', 'VS Code:github']);
  const gh = await market.item('mcp', 'vscode', 'VS Code:github', cwd);
  assert.deepEqual(gh.server.config, { url: 'https://api.githubcopilot.com/mcp/' });
  assert.deepEqual(gh.server.inputs, [{ header: 'Authorization', prefix: 'Bearer ', label: 'GitHub token', secret: true }]);
  const files = items.find(i => i.id === 'This project:files');
  assert.deepEqual(files.server.config, { command: 'node', args: [`${cwd}/mcp.js`], env: { MODE: 'dev' } });
  assert.deepEqual(files.server.inputs, [{ env: 'KEY', label: 'KEY', secret: false }]);
  assert.deepEqual((await market.search('mcp', 'vscode', '', null)).map(i => i.id).sort(), ['Cursor:memory', 'VS Code:github'], 'no project, no project servers');
  await assert.rejects(market.item('mcp', 'vscode', 'VS Code:gone', cwd), /no longer/);
});
