const MAX_BATCH_CHARS = 262_144, MAX_SUMMARY_CHARS = 32_000, MAX_ATTEMPTS = 64;
const IMAGE_COST = 8192, CONTINUATION = '[continued transcript text]\n';
const OPAQUE = new Set(['thinking', 'signature', 'signatures', 'thought_signature', 'encrypted_content', 'encrypted_index']);

export const isContextOverflow = err => Boolean(err && (err.code === 'context_length_exceeded' || err.status === 413));

const unsupported = () => { throw new Error('Cannot compact unsupported or malformed transcript content.'); };
// Only selected public metadata is serialized, never a raw turn or provider replay/signature envelope.
const publicJSON = value => JSON.stringify(value, (key, value) => OPAQUE.has(key) ? undefined : value);

function project(items) {
  const out = [];
  const text = value => {
    if (typeof value !== 'string') unsupported();
    if (value) out.push({ type: 'input_text', text: value });
  };
  const labeled = (label, value) => text(`[${label}]\n${value}`);
  const metadata = value => {
    for (const key of ['citations', 'annotations']) if (value[key] !== undefined) labeled(key, publicJSON(value[key]));
  };
  const image = (url, detail) => {
    if (typeof url !== 'string' || !url || (detail !== undefined && !['auto', 'low', 'high'].includes(detail))) unsupported();
    out.push({ type: 'input_image', image_url: url, ...(detail === undefined ? {} : { detail }) });
  };
  const toolCall = (id, name, args) => {
    if (typeof id !== 'string' || typeof name !== 'string' || typeof args !== 'string') unsupported();
    labeled('function_call', `call_id: ${id}\nname: ${name}\narguments:\n${args}`);
  };
  const toolOutput = (id, output) => {
    if (typeof id !== 'string') unsupported();
    labeled('function_call_output', `call_id: ${id}\n`);
    blocks(output);
  };
  const blocks = content => {
    if (typeof content === 'string') return text(content);
    if (!Array.isArray(content)) unsupported();
    for (const block of content) {
      if (!block || typeof block !== 'object') unsupported();
      switch (block.type) {
        case 'input_text': case 'output_text': case 'text': case 'summary_text': case 'reasoning_text':
          text(block.text);
          break;
        case 'refusal':
          if (typeof block.refusal !== 'string') unsupported();
          labeled('refusal', block.refusal);
          break;
        case 'input_image':
          image(block.image_url, block.detail);
          break;
        case 'image': {
          const source = block.source;
          if (source?.type === 'url') image(source.url);
          else if (source?.type === 'base64' && typeof source.media_type === 'string' && typeof source.data === 'string') {
            image(`data:${source.media_type};base64,${source.data}`);
          } else unsupported();
          break;
        }
        case 'tool_use': case 'server_tool_use':
          toolCall(block.id, block.name, JSON.stringify(block.input));
          if (block.caller !== undefined) labeled('tool caller', publicJSON(block.caller));
          break;
        case 'tool_result':
          toolOutput(block.tool_use_id, block.content);
          if (block.is_error !== undefined) labeled('tool result is_error', String(block.is_error));
          break;
        case 'web_search_tool_result': {
          const results = Array.isArray(block.content) ? block.content : [block.content];
          if (results.some(r => !['web_search_result', 'web_search_tool_result_error'].includes(r?.type))) unsupported();
          labeled('web_search_tool_result', publicJSON({ tool_use_id: block.tool_use_id, content: block.content }));
          break;
        }
        case 'thinking': case 'redacted_thinking':
          continue; // Opaque replay state, not public transcript content.
        default: unsupported();
      }
      metadata(block);
    }
  };
  const message = (role, content) => {
    const start = out.length;
    blocks(content);
    if (out.length > start) out.splice(start, 0, { type: 'input_text', text: `[${role}]\n` });
  };
  if (!Array.isArray(items)) unsupported();
  for (const item of items) {
    if (!item || typeof item !== 'object') unsupported();
    // The canonical raw Anthropic turn retains public text, calls, server search results and citations.
    if (item.anthropic && ['message', 'function_call'].includes(item.type)) continue;
    switch (item.type) {
      case undefined: case 'message':
        if (!['user', 'assistant', 'system', 'developer'].includes(item.role)) unsupported();
        message(item.role, item.content);
        break;
      case 'function_call':
        toolCall(item.call_id, item.name, item.arguments);
        break;
      case 'function_call_output':
        toolOutput(item.call_id, item.output);
        break;
      case 'anthropic_turn':
        message('assistant', item.content);
        break;
      case 'reasoning':
        if (item.summary !== undefined) message('reasoning summary', item.summary);
        if (item.content !== undefined) message('reasoning', item.content);
        break;
      case 'web_search_call':
        labeled('web_search_call', publicJSON({ id: item.id, status: item.status, action: item.action, results: item.results }));
        break;
      default: unsupported();
    }
    metadata(item);
  }
  if (!out.length) throw new Error('Cannot compact an empty transcript with no public content.');
  return out;
}

function take(parts, index, offset, budget) {
  const content = [];
  let cost = 0;
  while (index < parts.length) {
    const part = parts[index];
    if (part.type === 'input_image') {
      if (content.length && cost + IMAGE_COST > budget) break;
      content.push({ ...part }); // Fresh blocks isolate projection and source from callback mutation.
      cost += IMAGE_COST;
      index++;
    } else {
      if (cost >= budget) break;
      const prefix = offset ? CONTINUATION : '';
      let end = Math.min(part.text.length, offset + Math.max(1, budget - cost - prefix.length));
      // Never cut between a UTF-16 surrogate pair; the floor is one Unicode code point.
      if (end < part.text.length && /[\uD800-\uDBFF]/.test(part.text[end - 1]) && /[\uDC00-\uDFFF]/.test(part.text[end])) end--;
      if (end === offset) end += part.text.codePointAt(offset) > 0xffff ? 2 : 1;
      const text = prefix + part.text.slice(offset, end);
      content.push({ type: 'input_text', text });
      cost += text.length;
      if (end < part.text.length) { offset = end; break; }
      index++;
      offset = 0;
    }
  }
  return { content, index, offset, cost };
}

export async function compactTranscript(items, summarize, signal) {
  signal?.throwIfAborted();
  const parts = project(items); // Preflight every meaningful type before paying for any callback.
  let index = 0, offset = 0, budget = MAX_BATCH_CHARS, summary = '';
  for (let attempts = 0; index < parts.length; attempts++) {
    signal?.throwIfAborted();
    // Bound both successful chunks and overflow retries: at most 64 callback attempts per fallback.
    if (attempts === MAX_ATTEMPTS) throw new Error('Compaction 64-callback attempt limit reached before the whole transcript was summarized.');
    const batch = take(parts, index, offset, budget);
    let candidate;
    try {
      candidate = await summarize(batch.content, summary);
    } catch (err) {
      signal?.throwIfAborted();
      if (!isContextOverflow(err)) throw err;
      const smaller = Math.max(1, Math.floor(Math.min(budget, batch.cost) / 2));
      const retry = take(parts, index, offset, smaller);
      if (retry.index === batch.index && retry.offset === batch.offset) throw err; // Atomic image / one code point cannot shrink.
      budget = smaller;
      continue;
    }
    signal?.throwIfAborted();
    if (typeof candidate !== 'string' || !candidate.trim()) throw new Error('Compaction callback returned an empty or invalid summary.');
    if (candidate.length > MAX_SUMMARY_CHARS) throw new Error('Compaction summary exceeds the 32000-character rolling summary limit.');
    summary = candidate;
    index = batch.index;
    offset = batch.offset;
  }
  return summary;
}
