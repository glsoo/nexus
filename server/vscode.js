import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './util.js';

// Settings of VS Code and the editors built on it, read only when the user asks Nexus to import them.
const APPS = [['VS Code', 'Code'], ['VS Code Insiders', 'Code - Insiders'], ['Cursor', 'Cursor'], ['Windsurf', 'Windsurf'], ['VSCodium', 'VSCodium']];
const appData = () => (process.platform === 'win32' ? process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming')
  : process.platform === 'darwin' ? path.join(HOME, 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'));
export const editors = () => APPS.map(([app, folder]) => ({ app, dir: path.join(appData(), folder, 'User') })).filter(e => fs.existsSync(e.dir));

// Their files are JSON with comments and trailing commas.
export function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      // Strings are copied whole, so a comma at the end of the output here is always JSON's own.
      out = c === '}' || c === ']' ? out.replace(/,\s*$/, '') + c : out + c;
      i++;
    }
  }
  return JSON.parse(out);
}
const readJsonc = file => { try { return parseJsonc(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// VS Code's chat.tools.terminal.autoApprove: true auto-approves, false always asks, or { approve } says the same.
export function terminalRules() {
  return editors().flatMap(({ app, dir }) => {
    const file = path.join(dir, 'settings.json');
    const rules = readJsonc(file)?.['chat.tools.terminal.autoApprove'];
    const commands = {};
    for (const [rule, v] of Object.entries(rules && typeof rules === 'object' ? rules : {})) {
      const approve = v && typeof v === 'object' ? v.approve : v;
      if (typeof approve === 'boolean' && rule.trim()) commands[rule] = approve ? 'allow' : 'ask';
    }
    return Object.keys(commands).length ? [{ app, file, commands }] : [];
  });
}

// MCP servers set up for VS Code (mcp.json "servers", or "mcp.servers" in settings), Cursor and Windsurf ("mcpServers"),
// for this user and in this project. Listed for the user to install one by one, each showing exactly what it runs.
export function editorServers(cwd) {
  const found = new Map();
  const read = (where, file, pick) => {
    const json = readJsonc(file);
    const servers = json && pick(json);
    for (const [name, conf] of Object.entries(servers && typeof servers === 'object' ? servers : {})) {
      if (conf && typeof conf === 'object' && !found.has(`${where}:${name}`)) found.set(`${where}:${name}`, { where, file, name, conf, inputs: Array.isArray(json.inputs) ? json.inputs : [] });
    }
  };
  for (const { app, dir } of editors()) {
    read(app, path.join(dir, 'mcp.json'), j => j.servers);
    read(app, path.join(dir, 'settings.json'), j => j.mcp?.servers);
  }
  read('Cursor', path.join(HOME, '.cursor', 'mcp.json'), j => j.mcpServers);
  read('Windsurf', path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json'), j => j.mcpServers);
  if (cwd) {
    read('This project', path.join(cwd, '.vscode', 'mcp.json'), j => j.servers);
    read('This project', path.join(cwd, '.cursor', 'mcp.json'), j => j.mcpServers);
  }
  return [...found.values()];
}
