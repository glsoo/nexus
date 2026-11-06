import assert from 'node:assert/strict';
import test from 'node:test';
import { compactTranscript, isContextOverflow } from '../server/compaction.js';

const overflow = () => Object.assign(new Error('Fixture context overflow'), { code: 'context_length_exceeded' });
const textOf = blocks => blocks.filter(b => b.type === 'input_text').map(b => b.text).join('');
const withoutContinuations = text => text.replaceAll('[continued transcript text]\n', '');
const user = content => ({ role: 'user', content });
const result = (call_id, output) => ({ type: 'function_call_output', call_id, output });
const call = (call_id, name, args = '{}') => ({ type: 'function_call', call_id, name, arguments: args });
const frozen = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
};
const legal = blocks => {
  assert.ok(blocks.length);
  for (const block of blocks) {
    if (block.type === 'input_text') {
      assert.deepEqual(Object.keys(block).sort(), ['text', 'type']);
      assert.equal(typeof block.text, 'string');
    } else {
      assert.equal(block.type, 'input_image');
      assert.deepEqual(Object.keys(block).sort(), block.detail === undefined ? ['image_url', 'type'] : ['detail', 'image_url', 'type']);
      assert.equal(typeof block.image_url, 'string');
    }
  }
};

test('overflow classification uses only normalized context code or HTTP 413', () => {
  for (const err of [{ code: 'context_length_exceeded' }, { status: 413 }]) assert.equal(isContextOverflow(err), true);
  for (const err of [null, undefined, {}, { code: 400 }, { status: 400, message: 'maximum context length' },
    { status: 401 }, { status: 403 }, { status: 429 }, { status: 500 }, { status: '413' },
    { code: 'ECONNRESET' }, { code: 'incomplete_response' }, { type: 'refusal' }, { message: 'prompt is too long' }]) {
    assert.equal(isContextOverflow(err), false);
  }
});

test('normal projection keeps chronological user/assistant text and call identity without modifying source', async () => {
  const items = frozen([
    user('First instruction.'),
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'First answer.' }] },
    call('parallel-a', 'Read', '{ "file_path": "a.js" }'), call('parallel-b', 'Grep', '{"pattern":"next"}'),
    result('parallel-a', 'Read output.'), result('parallel-b', 'Grep output.'),
    user([{ type: 'input_text', text: 'Last instruction.' }]),
  ]);
  const before = structuredClone(items);
  let attempts = 0;
  const summary = await compactTranscript(items, async (blocks, previous) => {
    attempts++;
    legal(blocks);
    assert.equal(previous, '');
    const text = textOf(blocks);
    let position = -1;
    for (const expected of ['First instruction.', 'First answer.', 'parallel-a', 'Read', '{ "file_path": "a.js" }',
      'parallel-b', 'Grep', '{"pattern":"next"}', 'Read output.', 'Grep output.', 'Last instruction.']) {
      position = text.indexOf(expected, position + 1);
      assert.ok(position >= 0, `missing or out of order: ${expected}`);
    }
    return 'Complete fixture summary.';
  });
  assert.equal(summary, 'Complete fixture summary.');
  assert.equal(attempts, 1);
  assert.deepEqual(items, before);
});

test('context overflow shrinks locally, preserves order, and reuses only accepted summaries and budgets', async () => {
  const payload = 'αβγ|'.repeat(70_000);
  const items = frozen([user(payload)]);
  const before = structuredClone(items);
  const accepted = [], failures = [], lengths = [];
  let previousSummary = '', count = 0;
  const summary = await compactTranscript(items, async (blocks, previous) => {
    legal(blocks);
    assert.equal(previous, previousSummary, 'failed candidates must not replace the accepted summary');
    const text = textOf(blocks);
    if (text.length > 50_000) {
      failures.push(text.length);
      if (failures.length % 2) throw overflow();
      throw Object.assign(new Error('Fixture body too large'), { status: 413 });
    }
    accepted.push(withoutContinuations(text));
    lengths.push(text.length);
    previousSummary = `Accepted ${++count}`;
    return previousSummary;
  });
  assert.equal(summary, previousSummary);
  assert.ok(failures.length >= 3);
  assert.ok(failures.every((n, i) => !i || n < failures[i - 1]));
  assert.ok(lengths.length > 2);
  assert.ok(lengths.slice(0, -1).every(n => n <= lengths[0]), 'accepted budget must not reset on the next batch');
  assert.equal(accepted.join(''), `[user]\n${payload}`);
  assert.deepEqual(items, before);
});

test('a single oversized function output is completely covered across batches', async () => {
  const payload = '0123456789abcdef\n'.repeat(60_000);
  const items = frozen([call('huge-call', 'Bash', '{"command":"fixture"}'), result('huge-call', payload)]);
  const accepted = [];
  const summary = await compactTranscript(items, async (blocks, previous) => {
    legal(blocks);
    assert.equal(previous, accepted.length ? `Batch ${accepted.length}` : '');
    assert.ok(textOf(blocks).length <= 262_144);
    accepted.push(withoutContinuations(textOf(blocks)));
    return `Batch ${accepted.length}`;
  });
  assert.equal(summary, `Batch ${accepted.length}`);
  assert.ok(accepted.length >= 4);
  const text = accepted.join('');
  const start = text.indexOf(payload.slice(0, 100));
  assert.equal(text.slice(start), payload);
  assert.match(text.slice(0, start), /huge-call/);
  assert.match(text.slice(0, start), /Bash/);
});

test('parallel tools, raw Anthropic turns, public search metadata, reasoning summaries and real images project without mirrors or ciphertext', async () => {
  const image = { type: 'input_image', image_url: 'data:image/png;base64,ZmFrZS1waWN0dXJl', detail: 'high' };
  const citation = { type: 'web_search_result_location', url: 'https://fixture.test/anthropic', title: 'Anthropic source', cited_text: 'Public quote.', encrypted_index: 'OPAQUE_INDEX' };
  const annotation = { type: 'url_citation', url: 'https://fixture.test/openai', title: 'OpenAI source', start_index: 0, end_index: 14 };
  const items = frozen([
    user([{ type: 'input_text', text: 'Inspect this image.' }, image]),
    { type: 'reasoning', encrypted_content: 'OPAQUE_OPENAI', summary: [{ type: 'summary_text', text: 'Visible reasoning summary.' }] },
    call('a', 'Read', '{"path":"a"}'), call('b', 'Grep', '{"pattern":"b"}'),
    result('a', 'Parallel result A.'), result('b', [image]),
    { type: 'web_search_call', id: 'search-openai', status: 'completed', action: { type: 'search', query: 'fixture query', sources: [{ type: 'url', url: 'https://fixture.test/source' }] } },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OpenAI answer.', annotations: [annotation] }] },
    { type: 'anthropic_turn', content: [
      { type: 'thinking', thinking: 'OPAQUE_THINKING', signature: 'OPAQUE_SIGNATURE' },
      { type: 'redacted_thinking', data: 'OPAQUE_REDACTED' },
      { type: 'text', text: 'Canonical Anthropic answer.', citations: [citation] },
      { type: 'tool_use', id: 'anthropic-call', name: 'Glob', input: { pattern: '*.js', encrypted_content: 'literal tool argument' } },
      { type: 'server_tool_use', id: 'search-anthropic', name: 'web_search', input: { query: 'anthropic query' } },
      { type: 'web_search_tool_result', tool_use_id: 'search-anthropic', content: [
        { type: 'web_search_result', url: 'https://fixture.test/result', title: 'Result title', page_age: 'November 1, 2026', encrypted_content: 'OPAQUE_SEARCH' },
      ] },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'YW50aHJvcGljLWltYWdl' } },
    ] },
    { type: 'message', role: 'assistant', anthropic: true, content: [{ type: 'output_text', text: 'Canonical Anthropic answer.' }] },
    { ...call('anthropic-call', 'Glob', '{"pattern":"*.js"}'), anthropic: true },
    result('anthropic-call', 'Canonical tool output.'),
    { type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'Historical refusal text.' }] },
  ]);
  const before = structuredClone(items);
  await compactTranscript(items, async (blocks, previous) => {
    legal(blocks);
    assert.equal(previous, '');
    const text = textOf(blocks);
    for (const value of ['Inspect this image.', 'Visible reasoning summary.', 'Parallel result A.', 'fixture query', 'https://fixture.test/source',
      'OpenAI answer.', ...Object.values(annotation).map(String), 'Canonical Anthropic answer.', 'anthropic-call', 'Glob', '*.js',
      'literal tool argument', 'anthropic query', citation.url, citation.title, citation.cited_text,
      'https://fixture.test/result', 'Result title', 'November 1, 2026', 'Canonical tool output.', 'Historical refusal text.']) {
      assert.ok(text.includes(value), `missing public value: ${value}`);
    }
    assert.equal(text.split('Canonical Anthropic answer.').length - 1, 1);
    assert.equal(text.split('Glob').length - 1, 1);
    for (const value of ['OPAQUE_', 'ZmFrZS1waWN0dXJl', 'YW50aHJvcGljLWltYWdl']) assert.equal(text.includes(value), false);
    assert.deepEqual(blocks.filter(b => b.type === 'input_image'), [image, image, { type: 'input_image', image_url: 'data:image/jpeg;base64,YW50aHJvcGljLWltYWdl' }]);
    return 'Combined format summary.';
  });
  assert.deepEqual(items, before);
});

test('raw Anthropic URL images and tool results stay public while signed replay state stays opaque', async () => {
  const items = frozen([{ type: 'anthropic_turn', content: [
    { type: 'text', text: 'Before raw image.' },
    { type: 'image', source: { type: 'url', url: 'https://fixture.test/picture.png' } },
    { type: 'tool_result', tool_use_id: 'raw-tool', is_error: true, content: [
      { type: 'text', text: 'Raw tool error.' }, { type: 'input_image', image_url: 'https://fixture.test/tool.png' },
    ] },
  ] }, {
    ...call('signed-call', 'Read', '{"signature":"literal argument"}'),
    compat: { model: 'gemini:fixture', extra_content: { google: { thought_signature: 'OPAQUE_COMPAT' } } },
  }]);
  await compactTranscript(items, async blocks => {
    legal(blocks);
    const text = textOf(blocks);
    for (const value of ['Before raw image.', 'raw-tool', 'Raw tool error.', '[tool result is_error]\ntrue', 'literal argument']) assert.ok(text.includes(value));
    assert.equal(text.includes('OPAQUE_COMPAT'), false);
    assert.deepEqual(blocks.filter(b => b.type === 'input_image').map(b => b.image_url), ['https://fixture.test/picture.png', 'https://fixture.test/tool.png']);
    return 'Raw tool summary.';
  });
});

test('web search errors and public metadata on message containers remain readable', async () => {
  const items = frozen([
    { type: 'web_search_call', id: 'open', action: { type: 'open_page', url: 'https://fixture.test/page' } },
    { type: 'web_search_call', id: 'find', action: { type: 'find_in_page', url: 'https://fixture.test/page', pattern: 'needle' } },
    { type: 'anthropic_turn', content: [{ type: 'web_search_tool_result', tool_use_id: 'search-error', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } }] },
    { type: 'message', role: 'assistant', content: 'Container text.', annotations: [{ type: 'url_citation', url: 'https://fixture.test/container', title: 'Container source' }] },
  ]);
  await compactTranscript(items, async blocks => {
    const text = textOf(blocks);
    for (const value of ['open_page', 'find_in_page', 'needle', 'search-error', 'max_uses_exceeded', 'Container text.', 'Container source', 'https://fixture.test/container']) {
      assert.ok(text.includes(value));
    }
    return 'Public metadata summary.';
  });
});

test('Unicode surrogate pairs remain whole at initial and adaptive split boundaries', async () => {
  const payload = 'x'.repeat(262_136) + '😀' + 'λ'.repeat(90);
  const chunks = [];
  await compactTranscript(frozen([user(payload)]), async blocks => {
    const text = textOf(blocks);
    assert.equal(text.isWellFormed(), true);
    chunks.push(withoutContinuations(text));
    return 'Unicode summary.';
  });
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), `[user]\n${payload}`);

  const accepted = [];
  await compactTranscript(frozen([user('😀')]), async blocks => {
    const text = withoutContinuations(textOf(blocks));
    assert.equal(text.isWellFormed(), true);
    if ([...text].length > 1) throw overflow();
    accepted.push(text);
    return 'One Unicode character accepted.';
  });
  assert.equal(accepted.join(''), '[user]\n😀');
});

test('an irreducible image overflow preserves the image and original provider error', async () => {
  const image = { type: 'input_image', image_url: 'data:image/png;base64,YXRvbWlj', detail: 'low' };
  const items = frozen([result('image-call', [image])]);
  const before = structuredClone(items), error = overflow();
  let attempts = 0;
  await assert.rejects(compactTranscript(items, async blocks => {
    attempts++;
    legal(blocks);
    if (blocks.some(b => b.type === 'input_image')) {
      assert.deepEqual(blocks.filter(b => b.type === 'input_image'), [image]);
      throw error;
    }
    return 'Label accepted.';
  }), err => err === error);
  assert.ok(attempts < 20);
  assert.deepEqual(items, before);
});

test('adaptive batches keep successful images atomic and isolate callback mutation from retries', async () => {
  const image = { type: 'input_image', image_url: 'data:image/png;base64,b3JpZ2luYWw=', detail: 'auto' };
  const items = frozen([user([{ type: 'input_text', text: 'Before image.' }, image, { type: 'input_text', text: 'After image.' }])]);
  const before = structuredClone(items), accepted = [];
  let rejected = false;
  await compactTranscript(items, async blocks => {
    legal(blocks);
    const images = blocks.filter(b => b.type === 'input_image');
    for (const block of images) assert.deepEqual(block, image);
    if (!rejected) {
      rejected = true;
      images[0].image_url = 'https://fixture.test/callback-mutation';
      blocks[0].text = 'Callback mutation.';
      throw overflow();
    }
    accepted.push(...blocks);
    return 'Image-bearing chunk accepted.';
  });
  assert.deepEqual(accepted.filter(b => b.type === 'input_image'), [image]);
  assert.equal(withoutContinuations(textOf(accepted)), '[user]\nBefore image.After image.');
  assert.ok(accepted.findIndex(b => b.type === 'input_image') > accepted.findIndex(b => b.text?.includes('Before image.')));
  assert.ok(accepted.findIndex(b => b.type === 'input_image') < accepted.findIndex(b => b.text?.includes('After image.')));
  assert.deepEqual(items, before);
});

test('image refusal is a non-size failure, not a reason to drop or replace the image', async () => {
  const image = { type: 'input_image', image_url: 'https://fixture.test/refused.png' };
  const items = frozen([user([image])]), before = structuredClone(items);
  const error = Object.assign(new Error('Fixture image refusal'), { status: 400, code: 'refusal' });
  let attempts = 0;
  await assert.rejects(compactTranscript(items, async blocks => {
    attempts++;
    assert.deepEqual(blocks.filter(b => b.type === 'input_image'), [image]);
    throw error;
  }), err => err === error);
  assert.equal(attempts, 1);
  assert.deepEqual(items, before);
});

test('a one-character text overflow fails with the provider error instead of looping', async () => {
  const error = overflow();
  let attempts = 0;
  await assert.rejects(compactTranscript(frozen([user('x')]), async () => {
    attempts++;
    throw error;
  }), err => err === error);
  assert.ok(attempts <= 5);
});

test('a later chunk failure stops without retries, partial success or source changes', async () => {
  const items = frozen([user('z'.repeat(600_000))]);
  const before = structuredClone(items), error = Object.assign(new Error('Fixture connection reset'), { code: 'ECONNRESET' });
  let attempts = 0;
  await assert.rejects(compactTranscript(items, async (blocks, previous) => {
    attempts++;
    if (attempts === 1) { assert.equal(previous, ''); return 'Accepted first chunk.'; }
    assert.equal(previous, 'Accepted first chunk.');
    throw error;
  }), err => err === error);
  assert.equal(attempts, 2);
  assert.deepEqual(items, before);
});

test('cancellation before and during callbacks forbids success and further attempts', async () => {
  for (const phase of ['before', 'success', 'overflow']) {
    const controller = new AbortController(), reason = new Error(`Cancelled ${phase}`);
    const items = frozen([user('q'.repeat(600_000))]), before = structuredClone(items);
    let attempts = 0;
    if (phase === 'before') controller.abort(reason);
    await assert.rejects(compactTranscript(items, async () => {
      attempts++;
      controller.abort(reason);
      if (phase === 'overflow') throw overflow();
      return 'Must not become a successful summary.';
    }, controller.signal), err => err === reason);
    assert.equal(attempts, phase === 'before' ? 0 : 1);
    assert.deepEqual(items, before);
  }
});

test('abort after an earlier accepted chunk or during the final callback never returns partial success', async () => {
  for (const chunks of [1, 2]) {
    const controller = new AbortController(), reason = new Error('Late compaction cancellation');
    const items = frozen([user('a'.repeat(chunks === 1 ? 100 : 400_000))]), before = structuredClone(items);
    let attempts = 0;
    await assert.rejects(compactTranscript(items, async (blocks, previous) => {
      attempts++;
      assert.equal(previous, attempts === 1 ? '' : 'Accepted earlier chunk.');
      if (attempts === chunks) controller.abort(reason);
      return 'Accepted earlier chunk.';
    }, controller.signal), err => err === reason);
    assert.equal(attempts, chunks);
    assert.deepEqual(items, before);
  }
});

test('the explicit 64-callback attempt limit bounds successful chunks as well as rejected requests', async () => {
  for (const rejectFirst of [false, true]) {
    const items = frozen([user('c'.repeat(262_144 * 65))]);
    let attempts = 0;
    await assert.rejects(compactTranscript(items, async () => {
      attempts++;
      if (rejectFirst && attempts === 1) throw overflow();
      return `Accepted ${attempts}`;
    }), /64.*attempt limit/i);
    assert.equal(attempts, 64);
    assert.equal(items[0].content.length, 262_144 * 65);
  }
});

test('blank, non-string and oversized callback summaries are rejected without truncation or retry', async () => {
  for (const candidate of ['', ' \n\t', null, undefined, 123, { text: 'Not a string' }, 's'.repeat(32_001)]) {
    const items = frozen([user('Keep this transcript.')]), before = structuredClone(items);
    let attempts = 0;
    await assert.rejects(compactTranscript(items, async () => { attempts++; return candidate; }), /summary/i);
    assert.equal(attempts, 1);
    assert.deepEqual(items, before);
  }
  const exact = 's'.repeat(32_000);
  assert.equal(await compactTranscript([user('Exact limit.')], async () => exact), exact);
});

test('refusal, auth, network, generic 400 and incomplete errors are never retried', async () => {
  for (const fields of [{ status: 401 }, { status: 403 }, { status: 429 }, { code: 'ECONNRESET' },
    { status: 400, message: 'maximum context length' }, { code: 'incomplete_response' }, { code: 'refusal' }]) {
    const error = Object.assign(new Error('Fixture non-size failure'), fields);
    let attempts = 0;
    await assert.rejects(compactTranscript(frozen([user('Keep me.')]), async () => { attempts++; throw error; }), err => err === error);
    assert.equal(attempts, 1);
  }
});

test('unsupported meaningful items, blocks, hosted results and unavailable images fail before callbacks', async () => {
  for (const unknown of [
    { type: 'computer_call', action: { type: 'click', x: 1, y: 2 } },
    { role: 'user', content: [{ type: 'input_file', file_id: 'fixture-file' }] },
    { role: 'user', content: [{ type: 'input_image', file_id: 'fixture-image' }] },
    { type: 'anthropic_turn', content: [{ type: 'web_fetch_tool_result', content: { text: 'Public fetch result.' } }] },
    { type: 'anthropic_turn', content: [{ type: 'web_search_tool_result', tool_use_id: 'future', content: [{ type: 'future_search_result', text: 'Public result.' }] }] },
  ]) {
    const items = frozen([user('Known earlier text.'), unknown]), before = structuredClone(items);
    let attempts = 0;
    await assert.rejects(compactTranscript(items, async () => { attempts++; return 'Must not run.'; }), /unsupported|cannot compact/i);
    assert.equal(attempts, 0);
    assert.deepEqual(items, before);
  }
});

test('an empty or entirely opaque transcript cannot silently produce a blank summary', async () => {
  for (const items of [[], [{ type: 'reasoning', summary: [], encrypted_content: 'OPAQUE' }]]) {
    let attempts = 0;
    await assert.rejects(compactTranscript(frozen(items), async () => { attempts++; return 'No content.'; }), /public|empty|nothing/i);
    assert.equal(attempts, 0);
  }
});
