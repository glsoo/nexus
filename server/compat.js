import { createHash } from 'node:crypto';
import { isAnthropic } from './anthropic.js';
import { apiKey, postWithRetry, readSettings, sseEvents } from './util.js';

// Any OpenAI-compatible Chat Completions server: OpenRouter, Ollama, LM Studio, or one added under "providers" in settings.json.
// Model ids are "<provider>:<model>", so "ollama:qwen3-coder:30b" is the model "qwen3-coder:30b" on Ollama.
const PRESETS = {
  openrouter: { name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY' },
  gemini: { name: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY' },
  groq: { name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' },
  deepseek: { name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', keyEnv: 'DEEPSEEK_API_KEY' },
  mistral: { name: 'Mistral', baseURL: 'https://api.mistral.ai/v1', keyEnv: 'MISTRAL_API_KEY' },
  xai: { name: 'xAI', baseURL: 'https://api.x.ai/v1', keyEnv: 'XAI_API_KEY' },
  // A DashScope key works only in the region that issued it: Singapore, US (Virginia), Beijing or Hong Kong.
  dashscope: { name: 'Alibaba Qwen', baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keyEnv: 'DASHSCOPE_API_KEY',
    regions: ['dashscope-intl', 'dashscope-us', 'dashscope', 'cn-hongkong.dashscope'].map(h => `https://${h}.aliyuncs.com/compatible-mode/v1`) },
  ollama: { name: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1', local: true },
  lmstudio: { name: 'LM Studio', baseURL: 'http://127.0.0.1:1234/v1', local: true },
};

export function providers() {
  const out = {};
  for (const [id, p] of Object.entries(PRESETS)) out[id] = { ...p, apiKey: p.keyEnv && apiKey(p.keyEnv) };
  const custom = readSettings().providers;
  for (const [id, c] of Object.entries(custom && typeof custom === 'object' ? custom : {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(id) || !c || typeof c !== 'object') continue;
    out[id] = { ...out[id], ...c, ...(c.baseURL ? { regions: undefined } : {}), name: String(c.name || out[id]?.name || id) };
  }
  return out;
}

export function providerOf(model) {
  const i = String(model).indexOf(':');
  return i > 0 && Object.hasOwn(providers(), model.slice(0, i)) ? model.slice(0, i) : null;
}

const headers = (id, p) => ({
  'content-type': 'application/json',
  ...(p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}),
  // OpenRouter lists the apps its users run, and these headers are how Nexus shows up there.
  ...(id === 'openrouter' ? { 'http-referer': 'https://github.com/glsoo/nexus', 'x-title': 'Nexus' } : {}),
});

// The first region that accepts a key is remembered for it. A baseURL in settings.json skips the search.
const regionOf = new Map();
async function located(id, p) {
  if (!p?.regions) return p;
  if (!regionOf.has(p.apiKey)) {
    for (const base of p.regions) {
      const res = await fetch(`${base}/models`, { headers: headers(id, p), signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (res?.ok) { regionOf.set(p.apiKey, base); break; }
    }
  }
  return { ...p, baseURL: regionOf.get(p.apiKey) || p.baseURL };
}

// ---- models ----
const lists = new Map();
// Per-token prices become per-million. Routers list -1 ("varies") and other servers use other shapes, so anything else is no price.
const perM = v => { const n = Number(v) * 1e6; return v !== null && v !== '' && Number.isFinite(n) && n >= 0 ? n : undefined; };
async function listModels(id, p) {
  // A list belongs to the key and server that fetched it, so a replaced key is checked again right away.
  const hit = lists.get(id), from = `${p.apiKey}\0${p.baseURL}`;
  if (hit && hit.from === from && Date.now() - hit.at < (p.local ? 15_000 : 3600_000)) return hit.list;
  p = await located(id, p);
  const res = await fetch(`${p.baseURL}/models`, { headers: headers(id, p), signal: AbortSignal.timeout(p.local ? 1500 : 10_000) });
  if (!res.ok) throw new Error(`${p.name} returned ${res.status} when listing models.`);
  const { data = [] } = await res.json();
  // An agent needs to chat and call tools, so models known not to (embeddings, speech, moderation) are left out.
  const list = data.filter(m => (!m.supported_parameters || m.supported_parameters.includes('tools')) && !/embed|moderation|whisper|tts|transcri|dall-e|imagen|image|veo|guard|realtime|audio|rerank|wanx?\d|paraformer|cosyvoice|sambert|asr\b/i.test(m.id)).map(m => ({
    id: `${id}:${m.id.replace(/^models\//, '')}`, name: m.name || m.id, provider: id, providerName: p.local ? `${p.name} · this computer` : p.name,
    context: m.context_length || undefined, efforts: [],
    ...(perM(m.pricing?.prompt) !== undefined && perM(m.pricing?.completion) !== undefined
      ? { price: [perM(m.pricing.prompt), perM(m.pricing.completion)], cachedPrice: perM(m.pricing.input_cache_read) } : p.local ? { price: [0, 0] } : {}),
  }));
  lists.set(id, { at: Date.now(), list, from });
  return list;
}

// ---- cost ----
// Estimates from list prices: the compatible server's own, else OpenRouter's public catalog, which also prices Anthropic and OpenAI models.
// A failed catalog fetch counts as empty for the hour, so an unreachable OpenRouter never slows every request.
let catalog = null;
const priceList = () => {
  if (!catalog || Date.now() - catalog.at > 3600_000) catalog = { at: Date.now(), list: listModels('openrouter', providers().openrouter).catch(() => []) };
  return catalog.list;
};
// "claude-haiku-4-5-20251001" and "openrouter:anthropic/claude-haiku-4.5" both become "claude-haiku-4-5".
const bare = id => id.toLowerCase().replace(/^.*\//, '').replace(/-\d{8}$|-\d{4}-\d{2}-\d{2}$/, '').replaceAll('.', '-');

// shortcut: Anthropic cache writes count at the plain input price (they cost 1.25x), since the usage passed in has dropped them.
export async function costOf(model, u) {
  const id = providerOf(model);
  const own = id ? (await listModels(id, providers()[id]).catch(() => [])).find(x => x.id === model) : null;
  // A server that lists no prices (DeepSeek, Gemini, ...) borrows the catalog's price for the same model name.
  const vendor = `openrouter:${id ? '' : isAnthropic(model) ? 'anthropic/' : 'openai/'}`, name = id ? model.slice(id.length + 1) : model, want = bare(name);
  const list = own?.price ? [] : await priceList();
  // A dated model keeps its own price when the catalog has it, before falling back to any version of the same name.
  const m = own?.price ? own : list.find(x => x.id === vendor + name) || list.find(x => x.id.startsWith(vendor) && bare(x.id) === want);
  if (!m?.price || !u) return undefined;
  const cached = u.input_tokens_details?.cached_tokens || 0;
  return (((u.input_tokens || 0) - cached) * m.price[0] + cached * (m.cachedPrice ?? m.price[0]) + (u.output_tokens || 0) * m.price[1]) / 1e6;
}

// Servers that aren't running or have no key are skipped, so they never hide the other providers.
export async function compatModels() {
  const all = Object.entries(providers()).filter(([, p]) => p.baseURL && (!p.keyEnv || p.apiKey));
  return (await Promise.allSettled(all.map(([id, p]) => listModels(id, p)))).flatMap(r => r.value || []);
}

export const compatContext = model => lists.get(providerOf(model))?.list.find(m => m.id === model)?.context;

// ---- requests ----
const part = c => (c.type === 'input_image' ? { type: 'image_url', image_url: { url: c.image_url } } : { type: 'text', text: c.text });

// Mistral only accepts 9-character alphanumeric tool call ids, so a chat that started elsewhere maps its ids onto that shape.
const mistralId = id => /^[a-zA-Z0-9]{9}$/.test(id) ? id : createHash('sha256').update(String(id)).digest('hex').slice(0, 9);
export function toMessages(instructions, items, provider) {
  const cid = provider === 'mistral' ? mistralId : x => x;
  const messages = [{ role: 'system', content: instructions }];
  let images = []; // a tool message can only hold text, so screenshots follow the tool results as a user message
  const flush = () => { if (images.length) messages.push({ role: 'user', content: images }); images = []; };
  for (const item of items) {
    if (item.type !== 'function_call_output') flush();
    const last = messages.at(-1);
    if (item.type === 'function_call') {
      const call = { id: cid(item.call_id), type: 'function', function: { name: item.name, arguments: item.arguments || '{}' } };
      if (last.role === 'assistant') (last.tool_calls ||= []).push(call);
      else messages.push({ role: 'assistant', content: null, tool_calls: [call] });
    } else if (item.type === 'function_call_output') {
      const text = typeof item.output === 'string';
      messages.push({ role: 'tool', tool_call_id: cid(item.call_id), content: text ? item.output : 'The image is attached in the next message.' });
      if (!text) images.push(...item.output.map(part));
    } else if (item.type === 'message' && item.role === 'assistant') {
      messages.push({ role: 'assistant', content: item.content.map(c => c.text || '').join('') });
    } else if (item.role === 'user') {
      messages.push({ role: 'user', content: typeof item.content === 'string' ? item.content : item.content.map(part) });
    } // reasoning, web search and raw Anthropic turns don't carry over
  }
  flush();
  return messages;
}

export async function callCompat({ model, instructions, input, tools, toolChoice }, sink, signal) {
  const id = providerOf(model), p = await located(id, providers()[id]);
  const fns = tools.filter(t => t.type === 'function').map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const body = {
    model: model.slice(id.length + 1), messages: toMessages(instructions, input, id), stream: true, stream_options: { include_usage: true },
    ...(fns.length ? { tools: fns, ...(toolChoice ? { tool_choice: toolChoice } : {}) } : {}),
  };
  let res;
  try {
    res = await postWithRetry(p.name, `${p.baseURL}/chat/completions`, headers(id, p), body, signal);
  } catch (err) {
    if (err.name === 'TypeError') throw new Error(`Couldn't reach ${p.name} at ${p.baseURL}. Is it running?`);
    if (/context.{0,20}(length|window)|too long|maximum context/i.test(err.message)) err.code = 'context_length_exceeded'; // OpenRouter sends a numeric code
    throw err;
  }
  const calls = [], open = {};
  let text = '', usage = {}, finish;
  const stream = (key, type, delta) => {
    open[key] ||= sink.add({ type, text: '', status: 'running' });
    open[key].text += delta;
    sink.delta(open[key], 'text', delta);
  };
  try {
    for await (const ev of sseEvents(res.body)) {
      if (ev.error) throw new Error(`${p.name}: ${ev.error.message || 'request failed'}`);
      if (ev.usage) usage = ev.usage;
      const choice = ev.choices?.[0];
      if (!choice) continue;
      const d = choice.delta || {};
      const thought = d.reasoning ?? d.reasoning_content;
      if (thought) stream('r', 'reasoning', thought);
      if (d.content) { text += d.content; stream('m', 'assistant', d.content); }
      for (const tc of d.tool_calls || []) {
        const c = calls[tc.index ?? calls.length] ||= { id: '', name: '', args: '' };
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name = tc.function.name;
        const a = tc.function?.arguments;
        if (a) c.args += typeof a === 'string' ? a : JSON.stringify(a);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  } finally {
    for (const entry of Object.values(open)) { entry.status = 'done'; sink.update(entry); }
  }
  const stamp = Date.now().toString(36);
  return {
    output: [
      ...(text ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] : []),
      ...calls.filter(Boolean).map((c, i) => ({ type: 'function_call', call_id: c.id || `call_${stamp}_${i}`, name: c.name, arguments: c.args || '{}' })),
    ],
    usage: {
      input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0, total_tokens: usage.total_tokens || 0,
      input_tokens_details: { cached_tokens: usage.prompt_tokens_details?.cached_tokens || 0 },
      output_tokens_details: { reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens || 0 },
    },
    incomplete: finish === 'length' ? 'max_output_tokens' : undefined,
  };
}
