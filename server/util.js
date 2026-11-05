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

export const KEY_NAMES = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY', 'XAI_API_KEY', 'DASHSCOPE_API_KEY'];
// Keys pasted into Settings live in their own file, so the settings.json editor never shows them. Nexus's environment wins over them.
export const keysPath = () => path.join(NEXUS_HOME, 'keys.json');
export const apiKey = name => process.env[name] || readJson(keysPath(), {})[name] || '';
// An empty value removes the key. writeAtomic keeps the file private to this user (0600).
export function saveKey(name, value) {
  if (!KEY_NAMES.includes(name)) throw Object.assign(new Error('Unknown key.'), { status: 404 });
  const v = String(value ?? '').trim();
  if (v.length > 500 || /\s/.test(v)) throw Object.assign(new Error("That doesn't look like an API key."), { status: 400 });
  const keys = readJson(keysPath(), {});
  if (v) keys[name] = v; else delete keys[name];
  writeAtomic(keysPath(), JSON.stringify(keys, null, 2));
}

// Everything the agent or terminal spawns runs without the panel's own secrets.
export function childEnv() {
  const env = { ...process.env };
  env.HOME ||= HOME;
  for (const key of Object.keys(env)) {
    const name = key.toUpperCase(); // Windows environment names are case-insensitive.
    if (KEY_NAMES.includes(name) || name === 'GOOGLE_API_KEY' || (name.startsWith('NEXUS_') && name !== 'NEXUS_URL')) delete env[key];
  }
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
// The native one, like everywhere else paths are compared: it also expands Windows short names (RUNNER~1) and fixes letter case,
// which the JS one leaves alone, so two spellings of one folder always compare equal.
export function realish(p) {
  const rest = [];
  let cur = path.resolve(p);
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...rest); } catch {
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
// API keys, tokens and private keys by their well-known shapes, so they stay out of places that keep text around.
export const SECRET = /\b(sk-(?:ant-|proj-|or-)?[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{30,}|AKIA[0-9A-Z]{16}|xox[abprs]-[\w-]{10,}|AIza[\w-]{30,}|glpat-[\w-]{20,}|gsk_\w{20,}|xai-\w{20,})|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
export const looksSecret = text => SECRET.test(String(text));

// A wait that ends early, with the signal's AbortError, when the user interrupts.
export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const stop = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
  signal?.addEventListener('abort', stop, { once: true });
});

// A key that has run out of money or quota. Waiting won't help; another provider might (settings.json "fallbackModels").
export const outOfCredit = err => err.status === 402 || err.code === 'insufficient_quota'
  || /credit balance|insufficient.{0,12}(balance|credit|funds|quota)|exceeded your current quota|out of credits?|payment required/i.test(err.message);

const header = (headers, name) => headers?.get ? headers.get(name) : Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name)?.[1];

// How long the server asked to wait, in ms: OpenAI's retry-after-ms, else retry-after in seconds or as a date.
function retryAfter(headers) {
  const ms = Number(header(headers, 'retry-after-ms'));
  if (ms > 0) return ms;
  const v = header(headers, 'retry-after');
  if (!v) return undefined;
  return Number(v) >= 0 ? Number(v) * 1000 : Math.max(0, Date.parse(v) - Date.now()) || undefined;
}

// Model diagnostics keep credentials private, even if Settings changes while a response is streaming.
// Neither credentials nor raw upstream objects are attached to the Error that callers may log or serialize.
const modelCredentials = new WeakMap(), modelErrors = new WeakSet();
const credentialName = name => /auth|api[-_]?key|token|secret|password|credential|signature|cookie|^(?:key|sig|pass|pwd)$/i.test(name);
const scalar = value => ['string', 'number', 'boolean'].includes(typeof value) ? value : undefined;
const decoded = value => { try { return decodeURIComponent(value); } catch { return value; } };
const encoded = value => { try { return encodeURIComponent(value); } catch { return value; } };
function requestCredentials(url, init) {
  const values = [];
  const add = value => { if (value) values.push(String(value)); };
  const headers = init?.headers;
  const entries = headers instanceof Headers || Array.isArray(headers) ? headers : Object.entries(headers || {});
  for (const [name, value] of entries) {
    if (!credentialName(name)) continue;
    add(value);
    const auth = /^(?:Bearer|Basic)\s+([\s\S]+)$/i.exec(String(value).trim());
    if (auth) add(auth[1]);
  }
  try {
    const u = new URL(url);
    for (const value of [u.username, u.password]) { add(value); add(decoded(value)); }
    for (const [name, value] of u.searchParams) if (credentialName(name)) add(value);
    for (const field of u.search.slice(1).split('&')) {
      const i = field.indexOf('=');
      if (i >= 0 && credentialName(decoded(field.slice(0, i)))) add(field.slice(i + 1));
    }
  } catch { /* fetch will report an invalid URL */ }
  return [...new Set(values.flatMap(value => [value, encoded(value), JSON.stringify(value).slice(1, -1)]))].sort((a, b) => b.length - a.length);
}
function redactModel(text, credentials) {
  text = String(text);
  // Replace whole values before clipping; a token crossing a clipping boundary must not leave half a key behind.
  for (const value of credentials) text = text.split(value).join('[REDACTED]');
  return text.replace(/(https?:\/\/)[^\s/?#@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&]([^=\s&#]+)=)([^&#\s]*)/g, (match, prefix, name) => credentialName(decoded(name)) ? `${prefix}[REDACTED]` : match)
    .replace(/\b(Bearer|Basic)\s+[^\s,;"'<>]+/gi, '$1 [REDACTED]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED]')
    .replace(new RegExp(SECRET.source, 'g'), '[REDACTED]');
}

export async function modelFetch(label, url, init) {
  const credentials = requestCredentials(url, init); // capture before the first await, not when the stream fails
  try {
    const res = await fetch(url, init);
    modelCredentials.set(res, credentials);
    return res;
  } catch (err) {
    throw modelError(label, err, undefined, credentials);
  }
}

export function modelError(label, detail, res, credentials = modelCredentials.get(res) || []) {
  if (detail instanceof Error && modelErrors.has(detail)) return detail;
  const clean = value => clip(redactModel(value, credentials), 12000);
  const safe = value => scalar(value) === undefined ? undefined : typeof value === 'string' ? clean(value) : value;
  let body = detail;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* plain provider/proxy response */ } }
  let source = body;
  const envelopes = [body];
  for (let i = 0; i < 8; i++) {
    const next = source?.error ?? source?.response?.error;
    if (next === undefined || next === null || next === source) break;
    source = next;
    envelopes.unshift(source);
  }
  const messageOf = (value, depth = 0) => {
    if (scalar(value) !== undefined) return value;
    if (!value || depth > 4) return undefined;
    if (value instanceof SyntaxError) {
      // Native parser snippets may contain a shortened credential that whole-value redaction cannot match.
      const location = /(?: at position \d+(?: \(line \d+ column \d+\))?| \(line \d+ column \d+\))$/.exec(value.message)?.[0] || '';
      return `Invalid JSON response (SyntaxError${location}); response excerpt omitted for privacy.`;
    }
    // Read diagnostic fields only: never stringify echoed request bodies, headers, stacks or arbitrary objects.
    if (Array.isArray(value)) return value.slice(0, 16).map(v => messageOf(v, depth + 1)).filter(v => v !== undefined).join('; ') || undefined;
    for (const key of ['message', 'detail', 'title', 'error_description', 'reason', 'msg', 'description', 'text', 'errors']) {
      const text = messageOf(value[key], depth + 1);
      if (text !== undefined) return text;
    }
  };
  const provider = clean(label), message = messageOf(source) ?? 'Request failed (no provider error message).';
  const status = [res?.status, ...envelopes.flatMap(e => [e?.status, e?.statusCode, e?.code])].find(v => Number.isInteger(v) && v >= 400 && v <= 599);
  const err = new Error();
  err.provider = provider;
  if (status !== undefined) err.status = status;
  for (const key of ['code', 'type', 'param', 'location']) {
    const value = safe(envelopes.map(e => scalar(e?.[key])).find(v => v !== undefined));
    if (value !== undefined) err[key] = value;
  }
  const semantic = envelopes.map(e => e?.status).find(v => typeof v === 'string');
  if (semantic !== undefined) err.providerStatus = safe(semantic);
  const id = ['request-id', 'x-request-id', 'x-goog-request-id'].map(name => header(res?.headers, name)).find(Boolean)
    || envelopes.flatMap(e => [e?.request_id, e?.requestId, e?.response?.request_id, e?.response?.requestId]).find(v => scalar(v) !== undefined);
  if (scalar(id) !== undefined) err.requestId = safe(id);
  const delay = retryAfter(res?.headers) ?? envelopes.map(e => e?.retryAfter).find(v => Number.isFinite(v) && v >= 0);
  if (delay !== undefined) err.retryAfter = delay;
  const lines = [`${provider}${status === undefined ? '' : ` ${status}`}: ${message}`];
  const seen = new Set();
  let nodes = 0;
  const causes = (value, depth = 0) => {
    if (value == null || seen.has(value)) return;
    if (++nodes > 64 || depth > 12) { lines.push('… [additional causes truncated]'); return; }
    seen.add(value);
    const text = messageOf(value), code = scalar(value?.code);
    if (depth && (text !== undefined || code !== undefined)) lines.push(`Cause: ${text ?? 'Connection failed'}${code === undefined ? '' : ` (${code})`}`);
    if (err.code === undefined && code !== undefined) err.code = safe(code);
    if (value?.cause !== undefined) causes(value.cause, depth + 1);
    if (Array.isArray(value?.errors)) for (const child of value.errors) {
      if (nodes >= 64) { lines.push('… [additional causes truncated]'); break; }
      causes(child, depth + 1);
    }
  };
  causes(source);
  if (err.code !== undefined) err.providerCode = err.code;
  for (const [key, title] of [['code', 'Code'], ['type', 'Type'], ['providerStatus', 'Status'], ['param', 'Param'], ['location', 'Location'], ['requestId', 'Request ID']]) {
    if (err[key] !== undefined) lines.push(`${title}: ${err[key]}`);
  }
  err.message = clean(lines.join('\n'));
  if (source?.name === 'AbortError' || source?.name === 'TimeoutError') err.name = source.name;
  modelErrors.add(err);
  return err;
}

// settings.json "requestsPerMinute": at most that many requests a minute to each provider, counted across every chat and subagent,
// so a provider's per-minute limit (Anthropic's, for one) isn't hit in the first place. Off when unset or 0.
const started = new Map();
export async function pace(label, signal) {
  const limit = readSettings().requestsPerMinute;
  if (!(Number.isInteger(limit) && limit > 0)) return;
  if (!started.has(label)) started.set(label, []);
  const times = started.get(label);
  for (;;) {
    while (times.length && Date.now() - times[0] >= 60_000) times.shift();
    if (times.length < limit) return void times.push(Date.now());
    await sleep(60_000 - (Date.now() - times[0]) + 50, signal);
  }
}

export async function postWithRetry(label, url, headers, body, signal) {
  for (let attempt = 0; ; attempt++) {
    await pace(label, signal);
    const res = await modelFetch(label, url, { method: 'POST', signal, headers, body: JSON.stringify(body) });
    if (res.ok) return res;
    let detail;
    try { detail = await res.text(); } catch (err) { throw modelError(label, err, res); }
    const err = modelError(label, detail, res);
    // A few quick retries ride out a blip. A longer wait the server asks for is left to the chat's auto retry (settings.json "autoRetry").
    if ((res.status === 429 || res.status >= 500) && attempt < 4 && !outOfCredit(err) && !(err.retryAfter > 30_000)) {
      await sleep(Math.max(2000 * 2 ** attempt, err.retryAfter || 0), signal);
      continue;
    }
    throw err;
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
      if (line.startsWith('data:')) {
        const data = line.slice(5).trimStart();
        if (data && data !== '[DONE]') yield JSON.parse(data);
      }
    }
  }
  const data = buf.trimEnd().startsWith('data:') ? buf.slice(5).trim() : '';
  if (data && data !== '[DONE]') yield JSON.parse(data);
}
