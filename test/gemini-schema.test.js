import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-gemini-schema-'));
process.env.NEXUS_HOME = tmp;
process.env.GEMINI_API_KEY = 'fixture-gemini-key';
process.env.GROQ_API_KEY = 'fixture-groq-key';
const { callCompat } = await import('../server/compat.js');
const { TOOL_DEFS } = await import('../server/tools.js');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Public Whisper/Gradio MCP schema: a FileData object was changed to a URL string,
// but its object-only required list was left behind.
const fileInput = {
  required: ['path'], title: 'FileData', type: 'string',
  description: 'The audio input, typically a filepath to an audio file',
  format: 'Gradio File Input - a http or https url to a file',
};
const tool = parameters => ({ type: 'function', name: 'mcp__whisper__transcribe', description: 'Transcribe audio', parameters });
const done = () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n`);
const sink = () => ({ add: entry => entry, delta() {}, update() {} });
const call = (tools, model = 'gemini:fixture') => callCompat({ model, instructions: 'Test', input: [], tools }, sink());

function capture(t) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.match(String(url), /^https:\/\/(generativelanguage\.googleapis\.com\/v1beta\/openai|api\.groq\.com\/openai\/v1)\/chat\/completions$/);
    requests.push(JSON.parse(init.body));
    return done();
  });
  return requests;
}

test('Gemini accepts Gradio string inputs without the stale FileData path requirement', async t => {
  const parameters = {
    type: 'object', properties: { inputs: fileInput, task: { type: 'string', enum: ['transcribe', 'translate'], default: 'transcribe' } }, required: ['inputs'],
  };
  const original = structuredClone(parameters);
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    assert.equal(init.headers.authorization, 'Bearer fixture-gemini-key');
    sent = JSON.parse(init.body);
    if (sent.tools[0].function.parameters.properties.inputs.required) {
      return Response.json({ error: { code: 400, message: "schema at properties.inputs requires unspecified property 'path'", status: 'INVALID_ARGUMENT' } }, { status: 400 });
    }
    return done();
  });
  const result = await call([tool(parameters)]);
  assert.equal(result.output[0].content[0].text, 'ok');
  const expected = structuredClone(parameters);
  delete expected.properties.inputs.required;
  assert.deepEqual(sent.tools[0].function.parameters, expected);
  assert.deepEqual(parameters, original, 'MCP definitions must not be mutated for other models');
});

test('Gemini preserves real object requirements and every built-in tool schema', async t => {
  const requests = capture(t);
  const parameters = {
    type: 'object', required: ['file', 'implicit', 'mixed', 'required'], properties: {
      file: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
      implicit: { properties: { path: { type: 'string' } }, required: ['path'] },
      mixed: { type: ['object', 'null'], properties: { path: { type: 'string' } }, required: ['path'] },
      required: { type: 'string' },
    },
  };
  await call([...TOOL_DEFS, tool(parameters)]);
  assert.deepEqual(requests[0].tools.map(t => t.function.parameters), [...TOOL_DEFS.map(t => t.parameters), parameters]);
});

test('Gemini normalizes nested array, union and definition schemas but leaves literal data alone', async t => {
  const requests = capture(t);
  const literal = { type: 'string', required: ['literal-data'] };
  const parameters = {
    type: 'object', properties: {
      files: { type: 'array', items: { type: 'object', properties: { input: fileInput }, required: ['input'] } },
      optional: { anyOf: [fileInput, { type: 'null', required: ['path'] }] },
      union: { type: ['string', 'null'], required: ['path'] },
      labels: { type: 'object', additionalProperties: fileInput },
      literal: { type: 'object', default: literal, examples: [literal], enum: [literal], const: literal },
    },
    $defs: { File: fileInput }, definitions: { File: fileInput },
    allOf: [{ type: 'object', required: ['files'] }],
  };
  const original = structuredClone(parameters);
  await call([tool(parameters)]);
  const sent = requests[0].tools[0].function.parameters;
  for (const schema of [sent.properties.files.items.properties.input, sent.properties.optional.anyOf[0], sent.properties.optional.anyOf[1], sent.properties.union, sent.properties.labels.additionalProperties, sent.$defs.File, sent.definitions.File]) {
    assert.equal(Object.hasOwn(schema, 'required'), false);
  }
  assert.deepEqual(sent.properties.files.items.required, ['input']);
  assert.deepEqual(sent.allOf[0].required, ['files'], 'composition requirements without local properties still matter');
  assert.deepEqual(sent.properties.literal, parameters.properties.literal, 'defaults, examples, enum and const contain data, not schemas');
  assert.deepEqual(parameters, original);
});

test('other compatible providers keep the original MCP schema unchanged', async t => {
  const requests = capture(t);
  const parameters = { type: 'object', properties: { inputs: fileInput } };
  await call([tool(parameters)], 'groq:fixture');
  assert.deepEqual(requests[0].tools[0].function.parameters, parameters);
  assert.deepEqual(parameters.properties.inputs.required, ['path']);
});
