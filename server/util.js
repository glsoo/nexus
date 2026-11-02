import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();
export const PROJECTS = process.env.NEXUS_PROJECTS || path.join(HOME, 'projects');
export const NEXUS_HOME = process.env.NEXUS_HOME || path.join(HOME, '.nexus');
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export function presentSocket(id, home = NEXUS_HOME) {
  if (process.platform !== 'win32') return path.join(home, 'present', `${id}.sock`);
  const scope = createHash('sha256').update(path.resolve(home)).digest('hex').slice(0, 16);
  return `\\\\.\\pipe\\nexus-${scope}-${id}`;
}

export function shellCommand() {
  if (process.env.SHELL) return process.env.SHELL;
  if (process.platform !== 'win32') return 'bash';
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.join(HOME, 'AppData', 'Local', 'Programs')];
  const shell = roots.filter(Boolean).map(root => path.join(root, 'Git', 'bin', 'bash.exe')).find(file => fs.existsSync(file));
  if (!shell) throw new Error('Install Git for Windows, or set SHELL to the full path of Git Bash.');
  return shell;
}

export const validName = s => typeof s === 'string' && NAME.test(s);

export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').slice(0, 64).replace(/[^a-z0-9]+$/, '');
}

export const newId = (prefix = 'e') => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Everything the agent or terminal spawns runs without the panel's own secrets.
export function childEnv() {
  const env = { ...process.env };
  env.HOME ||= HOME;
  for (const key of Object.keys(env)) if (['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY', 'XAI_API_KEY'].includes(key) || (key.startsWith('NEXUS_') && key !== 'NEXUS_URL')) delete env[key];
  return env;
}

export function writeAtomic(file, data, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode });
  fs.renameSync(tmp, file);
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// realpath that also works for paths that don't exist yet (resolves the nearest existing ancestor).
export function realish(p) {
  const rest = [];
  let cur = path.resolve(p);
  for (;;) {
    try { return path.join(fs.realpathSync(cur), ...rest); } catch {
      const up = path.dirname(cur);
      if (up === cur) return path.resolve(p);
      rest.unshift(path.basename(cur));
      cur = up;
    }
  }
}

export function isInside(root, p) {
  const r = realish(root), t = realish(path.resolve(root, p));
  return t === r || t.startsWith(r + path.sep);
}

export function clip(text, max = 30000) {
  if (text.length <= max) return text;
  const half = max / 2;
  return `${text.slice(0, half)}\n\n… [${text.length - max} characters truncated] …\n\n${text.slice(-half)}`;
}

export const settingsPath = () => path.join(NEXUS_HOME, 'settings.json');
export const readSettings = () => readJson(settingsPath(), {});

export async function postWithRetry(label, url, headers, body, signal) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: 'POST', signal, headers, body: JSON.stringify(body) });
    if (res.ok) return res;
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4 && !/insufficient_quota/.test(text)) {
      await new Promise(r => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    let message = text.slice(0, 500), code;
    try { const e = JSON.parse(text).error; message = typeof e === 'string' ? e : e?.message || message; code = e?.code; } catch { /* raw text */ }
    throw Object.assign(new Error(`${label} ${res.status}: ${message}`), { code });
  }
}

export async function* sseEvents(body) {
  let buf = '';
  for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trimEnd();
      buf = buf.slice(i + 1);
      if (line.startsWith('data: ') && line !== 'data: [DONE]') yield JSON.parse(line.slice(6));
    }
  }
}
