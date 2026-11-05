import path from 'node:path';
import { NEXUS_HOME, readJson, saveKey, SECRET, writeAtomic } from './util.js';

// Keys and tokens pasted into a chat stay out of its transcript and out of what the model sees. A model provider's API key is
// saved where Settings → Models keeps keys. Anything else becomes $NEXUS_SECRET_1 (and so on), which that chat's shell commands
// get as an environment variable, so "use this token" still works. They're kept in ~/.nexus/secrets.json, private to this user.
// shortcut: a command can still print a secret it was given, which then shows in its output; this keeps secrets out of what
// you type, not out of everything the agent can do with them.
const PROVIDER_KEYS = [[/\bsk-ant-[\w-]{20,}/g, 'ANTHROPIC_API_KEY'], [/\bsk-or-[\w-]{20,}/g, 'OPENROUTER_API_KEY'], [/\bsk-proj-[\w-]{20,}/g, 'OPENAI_API_KEY'],
  [/\bAIza[\w-]{30,}/g, 'GEMINI_API_KEY'], [/\bgsk_\w{20,}/g, 'GROQ_API_KEY'], [/\bxai-\w{20,}/g, 'XAI_API_KEY']];
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const FILE = () => path.join(NEXUS_HOME, 'secrets.json');
const PROVIDER = { ANTHROPIC_API_KEY: 'Anthropic', OPENROUTER_API_KEY: 'OpenRouter', OPENAI_API_KEY: 'OpenAI', GEMINI_API_KEY: 'Gemini', GROQ_API_KEY: 'Groq', XAI_API_KEY: 'xAI' };

export const secretsOf = chat => (chat ? readJson(FILE(), {})[chat] || {} : {});
export function forget(chat) {
  const all = readJson(FILE(), {});
  if (all[chat]) { delete all[chat]; writeAtomic(FILE(), JSON.stringify(all)); }
}

// The text with its secrets taken out, and what was done with each, for the chat to say.
export function catchSecrets(chat, text) {
  const found = [];
  for (const [re, name] of PROVIDER_KEYS) {
    text = text.replace(re, value => { saveKey(name, value); found.push(`your ${PROVIDER[name]} key, now saved in Settings → Models`); return `[${PROVIDER[name]} API key, saved in Settings]`; });
  }
  const all = readJson(FILE(), {});
  const mine = { ...all[chat] };
  const vault = value => {
    const name = Object.keys(mine).find(k => mine[k] === value) || `NEXUS_SECRET_${Object.keys(mine).length + 1}`;
    mine[name] = value;
    found.push(`$${name}, for shell commands`);
    return `$${name}`;
  };
  text = text.replace(PRIVATE_KEY, vault).replace(new RegExp(SECRET.source, 'g'), vault);
  if (Object.keys(mine).length !== Object.keys(all[chat] || {}).length) writeAtomic(FILE(), JSON.stringify({ ...all, [chat]: mine }));
  return { text, found };
}
