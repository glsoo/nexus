import { apiKey, postWithRetry, sseEvents } from './util.js';

// Conversations stay in Responses format so a chat can switch provider at any time.
// An Anthropic turn is stored twice: raw (thinking and signatures must replay verbatim) and as flagged Responses items.
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MAX_PAUSES = 10;
const CACHE_MS = 3600_000;

export const isAnthropic = model => !/^(gpt-|o\d)/.test(model);
export const anthropicContext = model => cache.list.find(m => m.id === model)?.context;

const headers = () => ({ 'x-api-key': apiKey('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' });

let cache = { at: 0, list: [] };
export async function anthropicModels() {
  if (!apiKey('ANTHROPIC_API_KEY') || Date.now() - cache.at < CACHE_MS) return cache.list;
  const res = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: headers() });
  if (!res.ok) throw new Error(`Anthropic returned ${res.status} when listing models.`);
  const list = (await res.json()).data.map(m => ({
    id: m.id, name: m.display_name, provider: 'anthropic', providerName: 'Anthropic', context: m.max_input_tokens, maxOutput: m.max_tokens,
    efforts: LEVELS.filter(l => m.capabilities?.effort?.[l]?.supported),
    thinking: m.capabilities?.thinking?.types?.adaptive?.supported ? 'adaptive' : m.capabilities?.thinking?.types?.enabled?.supported ? 'enabled' : null,
    webSearch: Boolean(m.capabilities?.server_tools?.web_search),
    deprecated: m.lifecycle === 'deprecated',
  }));
  cache = { at: Date.now(), list };
  return list;
}

function imageBlock(url) {
  const data = /^data:(.*?);base64,(.*)$/s.exec(url);
  return { type: 'image', source: data ? { type: 'base64', media_type: data[1], data: data[2] } : { type: 'url', url } };
}

function userBlocks(content) {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  return content.map(c => (c.type === 'input_image' ? imageBlock(c.image_url) : { type: 'text', text: c.text })).filter(c => c.type !== 'text' || c.text);
}

const objectArgs = s => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };

function blocksOf(item) {
  if (item.anthropic) return null;
  if (item.type === 'anthropic_turn') return ['assistant', item.content];
  if (item.type === 'function_call') return ['assistant', [{ type: 'tool_use', id: item.call_id, name: item.name, input: objectArgs(item.arguments) }]];
  if (item.type === 'function_call_output') {
    const content = typeof item.output === 'string' ? item.output : item.output.map(c => imageBlock(c.image_url));
    return ['user', [{ type: 'tool_result', tool_use_id: item.call_id, content }]];
  }
  if (item.type === 'message' && item.role === 'assistant') return ['assistant', item.content.filter(c => c.text).map(c => ({ type: 'text', text: c.text }))];
  if (item.role === 'user') return ['user', userBlocks(item.content)];
  return null; // OpenAI reasoning and web search items mean nothing to Anthropic
}

export function toMessages(items) {
  const messages = [];
  for (const item of items) {
    const [role, content] = blocksOf(item) || [];
    if (!content?.length) continue;
    const last = messages.at(-1);
    if (last?.role === role) last.content.push(...content);
    else messages.push({ role, content: [...content] });
  }
  return messages;
}

const toTool = t => (t.type === 'web_search'
  ? { type: 'web_search_20250305', name: 'web_search' }
  : { name: t.name, description: t.description, input_schema: t.parameters });

function requestBody({ model, effort, instructions, input, tools, toolChoice }, info) {
  // Models without an effort setting answer 400 if they are sent one, so pick the nearest level they have.
  const levels = info?.efforts || [];
  const level = levels.includes(effort) ? effort : levels.filter(l => LEVELS.indexOf(l) < LEVELS.indexOf(effort)).at(-1) || levels[0];
  const maxTokens = info?.maxOutput || 16000;
  return {
    model, max_tokens: maxTokens, stream: true, system: instructions, messages: toMessages(input),
    cache_control: { type: 'ephemeral' },
    tools: tools.filter(t => t.type !== 'web_search' || !info || info.webSearch).map(toTool),
    ...(toolChoice ? { tool_choice: { type: toolChoice } } : {}),
    ...(info?.thinking === 'adaptive' ? { thinking: { type: 'adaptive', display: 'summarized' } } : {}),
    ...(info?.thinking === 'enabled' ? { thinking: { type: 'enabled', budget_tokens: Math.floor(maxTokens / 4) } } : {}),
    ...(level ? { output_config: { effort: level } } : {}),
  };
}

const post = (body, signal) => postWithRetry('Anthropic', 'https://api.anthropic.com/v1/messages', headers(), body, signal);

async function oneRequest(body, sink, signal) {
  const res = await post(body, signal);
  const blocks = [], open = new Map();
  let usage = {}, stop;
  const stream = (index, type, text) => {
    let entry = open.get(index);
    if (!entry) { entry = sink.add({ type, text: '', status: 'running' }); open.set(index, entry); }
    entry.text += text;
    sink.delta(entry, 'text', text);
  };
  try {
    for await (const ev of sseEvents(res.body)) {
      const block = blocks[ev.index];
      if (ev.type === 'message_start') usage = ev.message.usage;
      else if (ev.type === 'content_block_start') blocks[ev.index] = ev.content_block;
      else if (ev.type === 'content_block_delta') {
        const d = ev.delta;
        if (d.type === 'text_delta') { block.text += d.text; stream(ev.index, 'assistant', d.text); }
        else if (d.type === 'thinking_delta') { block.thinking += d.thinking; stream(ev.index, 'reasoning', d.thinking); }
        else if (d.type === 'signature_delta') block.signature = d.signature;
        else if (d.type === 'input_json_delta') block.json = (block.json || '') + d.partial_json;
        else if (d.type === 'citations_delta') (block.citations ||= []).push(d.citation);
      } else if (ev.type === 'content_block_stop') {
        if (block.json !== undefined) {
          try { block.input = JSON.parse(block.json || '{}'); } catch { block.cut = true; } // output limit hit mid-call
          delete block.json;
        }
        if (block.type === 'server_tool_use') sink.add({ type: 'tool', name: block.name, args: block.input, status: 'done', output: '' });
      } else if (ev.type === 'message_delta') {
        stop = ev.delta.stop_reason;
        usage = { ...usage, ...ev.usage };
      } else if (ev.type === 'error') {
        throw new Error(`Anthropic: ${ev.error?.message || 'request failed'}`);
      } else if (ev.type === 'message_stop') {
        return { stop, usage, content: blocks.filter(b => !b.cut && (b.type !== 'thinking' || b.signature) && (b.type !== 'text' || b.text.trim())) };
      }
    }
    throw new Error('The model stream ended unexpectedly.');
  } finally {
    for (const entry of open.values()) { entry.status = 'done'; sink.update(entry); }
  }
}

const mapUsage = u => ({
  input_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
  output_tokens: u.output_tokens || 0,
  input_tokens_details: { cached_tokens: u.cache_read_input_tokens || 0 },
  output_tokens_details: { reasoning_tokens: u.output_tokens_details?.thinking_tokens || 0 },
});

export async function callAnthropic(params, sink, signal) {
  const info = (await anthropicModels().catch(() => [])).find(m => m.id === params.model);
  const body = requestBody(params, info);
  const content = [];
  let result, output = 0;
  try {
    for (let i = 0; i < MAX_PAUSES; i++) {
      result = await oneRequest(content.length ? { ...body, messages: [...body.messages, { role: 'assistant', content }] } : body, sink, signal);
      content.push(...result.content);
      output += result.usage.output_tokens || 0;
      if (result.stop !== 'pause_turn') break; // a long server tool run asks to be resumed
    }
  } catch (err) {
    if (/prompt is too long/i.test(err.message)) err.code = 'context_length_exceeded';
    throw err;
  }
  const text = content.filter(b => b.type === 'text');
  const calls = content.filter(b => b.type === 'tool_use');
  return {
    output: [
      { type: 'anthropic_turn', content },
      ...(text.length ? [{ type: 'message', role: 'assistant', anthropic: true, content: text.map(b => ({ type: 'output_text', text: b.text })) }] : []),
      ...calls.map(b => ({ type: 'function_call', anthropic: true, call_id: b.id, name: b.name, arguments: JSON.stringify(b.input) })),
    ],
    usage: mapUsage({ ...result.usage, output_tokens: output }),
    incomplete: ['end_turn', 'tool_use', 'stop_sequence'].includes(result.stop) ? undefined : result.stop === 'max_tokens' ? 'max_output_tokens' : result.stop,
  };
}

export async function askAnthropic(model, instructions, text, signal, maxTokens = 64) {
  const res = await post({ model, max_tokens: maxTokens, system: instructions, messages: [{ role: 'user', content: text }] }, signal);
  return (await res.json()).content.find(b => b.type === 'text')?.text;
}
