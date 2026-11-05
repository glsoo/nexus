import assert from 'node:assert/strict';
import test from 'node:test';
import { childEnv } from '../server/util.js';

test('credential filtering also handles mixed-case Windows environment names', () => {
  const keys = ['openai_api_key', 'Anthropic_Api_Key', 'google_api_key', 'nexus_pass_hash', 'Nexus_User'];
  const saved = keys.map(key => process.env[key]);
  try {
    for (const key of keys) process.env[key] = 'fixture-secret';
    const env = childEnv();
    const forbidden = keys.map(key => key.toUpperCase());
    assert.deepEqual(Object.keys(env).filter(key => forbidden.includes(key.toUpperCase())), []);
  } finally {
    keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
  }
});

test('child processes cannot inherit panel provider keys or login settings', () => {
  const secrets = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY', 'XAI_API_KEY', 'NEXUS_USER', 'NEXUS_PASS_HASH'];
  const keys = [...secrets, 'NEXUS_URL'];
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of secrets) process.env[key] = 'fixture-secret';
    process.env.NEXUS_URL = 'https://fixture.invalid';
    const env = childEnv();
    for (const key of secrets) assert.equal(env[key], undefined, `${key} must not be passed to child processes`);
    assert.equal(env.NEXUS_URL, 'https://fixture.invalid');
    assert.ok(env.HOME);
    assert.equal(process.env.GEMINI_API_KEY, 'fixture-secret', 'the parent environment must remain intact');
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
