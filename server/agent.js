import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { askAnthropic, callAnthropic, anthropicContext, isAnthropic } from './anthropic.js';
import * as checkpoint from './checkpoint.js';
import { callCompat, compatContext, providerOf } from './compat.js';
import { agentDefs, commands, instructions, runHooks, skills } from './extensions.js';
import * as mcp from './mcp.js';
import * as projects from './projects.js';
import { promptParts, readPrompts, savePrompts, withInjection } from './prompts.js';
import { decide, execTool, hasTool, killGroup, ruleKey, shells, TOOL_DEFS } from './tools.js';
import { clip, NEXUS_HOME, newId, postWithRetry, readJson, readSettings, slug, sseEvents, writeAtomic } from './util.js';

export const hub = new EventEmitter();
hub.setMaxListeners(0);
const sessions = new Map();
export const agents = new Map();
const NAME_TIMEOUT = 8000;
const REPO = fs.realpathSync(new URL('..', import.meta.url));
const PARALLEL = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'Task', 'BashOutput', 'Skill']);
const SUB_EXCLUDED = new Set(['Task', 'TodoWrite', 'AskUserQuestion', 'ExitPlanMode']);
// 0 means off. Leaves room under the model's limit, because the summary request has to fit too.
const compactAt = s => {
  const limit = s.state.autoCompact ?? (readSettings().autoCompactTokens || 300000);
  const context = anthropicContext(s.state.model) || compatContext(s.state.model);
  return context ? Math.min(limit, Math.floor(context * 0.85)) : limit;
};

export function getSession(name) {
  let s = sessions.get(name);
  if (!s) {
    s = { name, state: projects.load(name), queue: [], pending: new Map(), running: false, controller: null };
    sessions.set(name, s);
  }
  return s;
}
const cwdOf = s => projects.projectDir(s.name);
export const isBusy = name => {
  const s = sessions.get(name);
  return Boolean(s?.running)
    || [...agents.values()].some(a => a.project === name && a.status === 'running')
    || [...shells.values()].some(sh => sh.project === name && sh.status === 'running');
};

export function publicState(s) {
  const { items, ...rest } = s.state;
  return { ...rest, name: s.name, running: s.running, compactAt: compactAt(s) };
}

const persist = s => projects.save(s.name, s.state);
const status = s => hub.emit('project', s.name, { t: 'status', running: s.running, usage: s.state.usage, todos: s.state.todos, mode: s.state.mode, model: s.state.model, effort: s.state.effort, agent: s.state.agent || '', autopilot: Boolean(s.state.autopilot), compactAt: compactAt(s) });
const send = (s, ev) => hub.emit('project', s.name, ev);

function addEntry(s, entry) {
  entry.id ||= newId();
  s.state.log.push(entry);
  send(s, { t: 'entry', entry });
  return entry;
}
const note = (s, text, type = 'system') => { addEntry(s, { type, text }); persist(s); };

const mainSink = s => ({
  add: entry => addEntry(s, entry),
  update: entry => send(s, { t: 'entry', entry }),
  delta: (entry, kind, text) => send(s, { t: 'delta', id: entry.id, kind, text }),
});

// ---- model call ----
export const supportsReasoning = m => /^(gpt-[5-9]|o\d)/.test(m);

export function requestBody({ model, effort, instructions: sys, input, tools, toolChoice, cacheKey }) {
  return {
    model, instructions: sys, store: false, stream: true, tools,
    input: input.filter(i => i.type !== 'anthropic_turn').map(({ anthropic, ...i }) => i),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
    ...(supportsReasoning(model) ? { reasoning: { effort: effort === 'max' ? 'xhigh' : effort, summary: 'auto' }, include: ['reasoning.encrypted_content'] } : {}),
  };
}

const fetchStream = (body, signal) => postWithRetry('OpenAI', 'https://api.openai.com/v1/responses', { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' }, body, signal);

async function callModel(params, sink, signal) {
  if (providerOf(params.model)) return callCompat(params, sink, signal);
  if (isAnthropic(params.model)) return callAnthropic(params, sink, signal);
  const res = await fetchStream(requestBody(params), signal);
  const open = new Map();
  const stream = (key, type, kind, text) => {
    let entry = open.get(key);
    if (!entry) { entry = sink.add({ type, text: '', status: 'running' }); open.set(key, entry); }
    entry.text += text;
    sink.delta(entry, kind, text);
  };
  try {
    for await (const ev of sseEvents(res.body)) {
      if (ev.type === 'response.output_text.delta') stream(`m${ev.item_id}`, 'assistant', 'text', ev.delta);
      else if (ev.type === 'response.reasoning_summary_text.delta') stream(`r${ev.item_id}`, 'reasoning', 'text', ev.delta);
      else if (ev.type === 'response.output_item.done' && ev.item.type === 'web_search_call') {
        sink.add({ type: 'tool', name: 'web_search', args: ev.item.action || {}, status: 'done', output: '' });
      } else if (ev.type === 'response.failed' || ev.type === 'error') {
        const err = ev.response?.error || ev.error || ev;
        throw Object.assign(new Error(`OpenAI: ${err.message || 'request failed'}`), { code: err.code });
      } else if (ev.type === 'response.completed' || ev.type === 'response.incomplete') {
        return { output: ev.response.output, usage: ev.response.usage, incomplete: ev.response.incomplete_details?.reason };
      }
    }
    throw new Error('The model stream ended unexpectedly.');
  } finally {
    for (const entry of open.values()) { entry.status = 'done'; sink.update(entry); }
  }
}

function addUsage(s, u) {
  if (!u) return;
  const t = s.state.usage;
  t.input += u.input_tokens || 0;
  t.output += u.output_tokens || 0;
  t.cached += u.input_tokens_details?.cached_tokens || 0;
  t.reasoning += u.output_tokens_details?.reasoning_tokens || 0;
  t.requests += 1;
}

// ---- system prompt ----
// The agent type a chat has switched to, if it still exists. Built-in types are written for subagents, so a chat can't take them.
function activeAgent(s) {
  return s.state.agent ? agentDefs(cwdOf(s)).find(d => d.name === s.state.agent && !d.builtin) || null : null;
}

// sub: a subagent brings its own role, so the chat's agent type stays out of its prompt.
function systemPrompt(s, extra = '', sub = false) {
  const cwd = cwdOf(s);
  const skillList = skills(cwd).map(k => `- ${k.name}: ${k.description}`).join('\n');
  const agentList = agentDefs(cwd).map(a => `- ${a.name}: ${a.description}`).join('\n');
  const memory = instructions(cwd);
  const { base, custom } = promptParts(cwd, s.state);
  const role = sub ? null : activeAgent(s);
  const planning = s.state.mode === 'plan'
    ? '\n\nPLAN MODE IS ACTIVE. Do not change anything. Research with read-only tools, then present your plan with ExitPlanMode.' : '';
  const autopilot = s.state.autopilot
    ? `\n\nAUTOPILOT IS ON. The user is away, so don't stop to ask: make the call, say what you assumed, finish the work and verify it.${s.state.mode === 'plan' ? ' Your ExitPlanMode plan is approved automatically, and then you implement it in the same turn.' : ''}` : '';
  return `${base}

# Environment
Project directory: ${cwd}
The conversation is stored in .nexus/ inside it. Leave that folder alone.
Platform: ${process.platform}. Date: ${new Date().toISOString().slice(0, 10)}. Permission mode: ${s.state.mode}.

# Available subagent types
${agentList}
${skillList ? `\n# Available skills (load with the Skill tool)\n${skillList}\n` : ''}${memory ? `\n# Project and user instructions\n${memory}\n` : ''}${custom}${role ? `\n# Your role: ${role.name}\nThe user switched this chat to the "${role.name}" agent. Work as it describes.\n\n${role.prompt.trim()}\n` : ''}${planning}${autopilot}${extra}`;
}

async function toolList(filter) {
  const defs = [...TOOL_DEFS, { type: 'web_search' }, ...await mcp.toolDefs()];
  return filter ? defs.filter(filter) : defs;
}

// A chat's agent type limits the tools, but the chat can always plan, ask and keep its task list.
const MAIN_ALWAYS = new Set(['TodoWrite', 'AskUserQuestion', 'ExitPlanMode']);
function mainTools(s) {
  const allowed = activeAgent(s)?.tools;
  if (!allowed) return toolList();
  return toolList(t => MAIN_ALWAYS.has(t.name || t.type) || allowed.includes(t.name || t.type));
}

// ---- tools ----
function waitFor(s, entry, signal) {
  return new Promise(resolve => {
    const onAbort = () => { s.pending.delete(entry.id); resolve({ decision: 'deny', message: 'Interrupted by user' }); };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    s.pending.set(entry.id, value => { signal.removeEventListener('abort', onAbort); s.pending.delete(entry.id); resolve(value); });
  });
}

// A subagent's approval prompts also appear in the main transcript, where the user is looking.
function surface(s, sink, entry) {
  if (sink.isSub && !s.state.log.includes(entry)) addEntry(s, entry);
  else sink.update(entry);
}
function setEntry(s, sink, entry, patch) {
  Object.assign(entry, patch);
  sink.update(entry);
  if (sink.isSub && s.state.log.includes(entry)) send(s, { t: 'entry', entry });
}

// Autopilot answers for the user without showing the prompt. Turning it on answers prompts already waiting (setOption).
function askUser(s, sink, entry, signal, kind) {
  if (s.state.autopilot) return { decision: 'auto' };
  Object.assign(entry, { status: 'awaiting', kind });
  surface(s, sink, entry);
  return waitFor(s, entry, signal);
}
const AUTO_ANSWER = 'Autopilot is on and the user is away, so nobody will answer. Use your best judgment, state the assumption you made, and continue.';
const AUTOPILOT_STEPS = 150; // ponytail: fixed cap so an unwatched turn can't run up an unbounded bill; make it a setting if people hit it

async function runTool(s, call, ctx) {
  const { sink, signal } = ctx;
  let args;
  try { args = JSON.parse(call.arguments || '{}'); } catch { args = null; }
  const entry = sink.add({ type: 'tool', name: call.name, args: args ?? { raw: call.arguments }, status: 'running', output: '', agent: ctx.agentLabel });
  const finish = (output, status = 'done') => {
    const display = typeof output === 'string' ? output : '[image]';
    setEntry(s, sink, entry, { status, output: clip(display, 60000) });
    return output;
  };
  if (!args) return finish('Tool arguments were not valid JSON. Retry with valid JSON.', 'error');
  const cwd = cwdOf(s);

  let verdict = decide(s.state, call.name, args, cwd);
  if (verdict.action === 'deny') return finish(verdict.reason, 'denied');
  const pre = await runHooks('PreToolUse', { tool: call.name, input: args }, cwd);
  if (pre.blocked) return finish(`Blocked by hook: ${pre.reason}`, 'denied');
  if (verdict.action === 'ask') {
    const answer = await askUser(s, sink, entry, signal);
    if (answer.decision === 'deny') return finish(answer.message ? `User denied this: ${answer.message}` : 'User denied this tool call.', 'denied');
    if (answer.decision === 'always') s.state.allow.push(ruleKey(call.name, args, cwd));
    setEntry(s, sink, entry, { status: 'running', autopilot: answer.decision === 'auto' || undefined });
    persist(s);
  }

  try {
    const output = await execute(s, call.name, args, entry, ctx);
    runHooks('PostToolUse', { tool: call.name, input: args, output: typeof output === 'string' ? output.slice(0, 20000) : '' }, cwd).catch(() => {});
    return finish(output);
  } catch (err) {
    return finish(signal.aborted ? 'Interrupted by user' : `Error: ${err.message}`, signal.aborted ? 'interrupted' : 'error');
  }
}

async function execute(s, name, args, entry, ctx) {
  const { sink, signal } = ctx;
  const cwd = cwdOf(s);
  switch (name) {
    case 'TodoWrite':
      s.state.todos = Array.isArray(args.todos) ? args.todos : [];
      status(s);
      return 'Task list updated.';
    case 'AskUserQuestion': {
      const answer = await askUser(s, sink, entry, signal, 'question');
      if (answer.decision === 'auto') { entry.autopilot = true; return AUTO_ANSWER; }
      return answer.decision === 'deny' ? 'The user dismissed the question.' : `User answered: ${answer.answer}`;
    }
    case 'ExitPlanMode': {
      const answer = await askUser(s, sink, entry, signal, 'plan');
      if (answer.decision === 'deny') return `The user rejected the plan. ${answer.message || 'Stay in plan mode and ask what to change.'}`;
      const auto = answer.decision === 'auto';
      s.state.mode = auto || answer.mode === 'acceptEdits' ? 'acceptEdits' : 'default';
      status(s);
      if (!auto) return 'Plan approved. Plan mode is off; start implementing.';
      entry.autopilot = true;
      addEntry(s, { type: 'system', text: 'Autopilot approved the plan and switched to **Accept edits**.' });
      return 'Plan approved automatically, because autopilot is on and the user is away. Plan mode is off and file edits in the project are accepted. Implement the whole plan now, then verify it.';
    }
    case 'Skill': {
      const skill = skills(cwd).find(k => k.name === args.name);
      if (!skill) throw new Error(`Unknown skill ${args.name}.`);
      return `Skill base directory: ${skill.dir}\n\n${skill.body}`;
    }
    case 'Task':
      return runSubagent(s, args, signal);
  }
  if (name.startsWith('mcp__')) return mcp.call(name, args);
  if (!hasTool(name)) throw new Error(`Unknown tool ${name}.`);
  return execTool(name, args, {
    cwd, signal, session: s,
    progress: text => { if (!sink.isSub) { entry.output = (entry.output + text).slice(-60000); sink.delta(entry, 'output', text); } },
  });
}

async function runCalls(s, calls, ctx) {
  const results = [];
  if (calls.every(c => PARALLEL.has(c.name))) {
    results.push(...await Promise.all(calls.map(c => runTool(s, c, ctx))));
  } else {
    for (const c of calls) {
      results.push(ctx.signal.aborted ? 'Interrupted by user' : await runTool(s, c, ctx));
    }
  }
  return calls.map((c, i) => ({ type: 'function_call_output', call_id: c.call_id, output: results[i] }));
}

// ---- the loop, shared by conversations and subagents ----
async function loop(s, { items, sink, model, effort, sys, tools, signal, agentLabel, drain, onUsage, compact }) {
  let retriedCompact = false, autoSteps = 0;
  for (;;) {
    await drain?.();
    let result;
    try {
      result = await callModel({ model: model(), effort: effort(), instructions: sys(), input: items(), tools: await tools(), cacheKey: s.name }, sink, signal);
    } catch (err) {
      if (compact && compactAt(s) && err.code === 'context_length_exceeded' && !retriedCompact) {
        retriedCompact = true;
        await compact();
        continue;
      }
      if (/^[\w .-]+ 400: .*\bimage\b/i.test(err.message) && projects.dropImages(items())) {
        sink.add({ type: 'system', text: 'The API rejected an image, so it was removed from the conversation.' });
        continue;
      }
      throw err;
    }
    retriedCompact = false;
    onUsage(result.usage);
    items().push(...result.output);
    if (result.incomplete) sink.add({ type: 'system', text: `The model stopped early: ${result.incomplete}.` });
    const calls = result.output.filter(o => o.type === 'function_call');
    if (calls.length) items().push(...await runCalls(s, calls, { sink, signal, agentLabel }));
    if (sink.persist) sink.persist();
    if (signal.aborted) throw new DOMException('Interrupted', 'AbortError');
    if (compact && compactAt(s) && (result.usage?.input_tokens || 0) > compactAt(s)) await compact();
    if (!calls.length && !drain?.pendingCount?.()) return result.output.filter(o => o.type === 'message').flatMap(o => o.content).map(c => c.text || '').join('');
    if (s.state.autopilot && ++autoSteps >= AUTOPILOT_STEPS) {
      const text = `Autopilot stopped here after ${AUTOPILOT_STEPS} model requests in one go, so an unwatched loop can't run up the bill. Send a message to continue.`;
      sink.add({ type: 'system', text });
      return text;
    }
  }
}

// ---- subagents ----
const agentFile = a => path.join(projects.projectDir(a.project), '.nexus', 'subagents', `${a.id}.json`);
const agentPublic = ({ controller, items, log, ...a }) => a;
const saveAgent = a => { const { controller, ...rest } = a; writeAtomic(agentFile(a), JSON.stringify(rest)); };
const announce = (a, entry) => hub.emit('agent', { agent: agentPublic(a), entry });

export function listAgents() {
  // Finished agents from earlier server runs are on disk.
  for (const { name } of projects.list()) {
    const dir = path.join(projects.projectDir(name), '.nexus', 'subagents');
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      if (agents.has(id)) continue;
      const a = readJson(path.join(dir, f));
      if (a) agents.set(id, { ...a, project: name, status: a.status === 'running' ? 'interrupted' : a.status });
    }
  }
  return [...agents.values()].map(agentPublic).sort((x, y) => y.started - x.started);
}
export const getAgent = id => agents.get(id);
export function stopAgent(id) { agents.get(id)?.controller?.abort(); }

export function runSubagent(s, args, parentSignal) {
  const cwd = cwdOf(s);
  const def = agentDefs(cwd).find(d => d.name === (args.subagent_type || 'general-purpose'));
  if (!def) throw new Error(`Unknown subagent type "${args.subagent_type}". Available: ${agentDefs(cwd).map(d => d.name).join(', ')}`);
  const background = Boolean(args.run_in_background);
  const controller = new AbortController();
  if (!background && parentSignal) parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
  const a = {
    id: newId('agent'), project: s.name, type: def.name, description: args.description || def.name, prompt: args.prompt, background,
    status: 'running', started: Date.now(), ended: null, tokens: 0, model: def.model || s.state.model, log: [], controller, result: '',
  };
  agents.set(a.id, a);
  announce(a);
  const items = [{ role: 'user', content: args.prompt }];
  const sink = {
    isSub: true,
    add(entry) { entry.id ||= newId(); a.log.push(entry); announce(a, entry); return entry; },
    update(entry) { announce(a, entry); },
    delta() {},
  };
  const allowed = def.tools ? new Set(def.tools) : null;
  const work = loop(s, {
    items: () => items, sink, model: () => a.model, effort: () => s.state.effort, signal: controller.signal, agentLabel: a.description,
    sys: () => systemPrompt(s, `\n\n# Your role\n${def.prompt}\nYour final message is returned to the agent that launched you, so include everything it needs.`, true),
    tools: () => toolList(t => {
      const n = t.name || t.type;
      return !SUB_EXCLUDED.has(n) && (!allowed || allowed.has(n));
    }),
    onUsage: u => { addUsage(s, u); a.tokens += u?.total_tokens || 0; persist(s); status(s); announce(a); },
  }).then(text => {
    a.result = text; a.status = 'completed';
    return text || '(The subagent returned no text.)';
  }).catch(err => {
    a.status = controller.signal.aborted ? 'stopped' : 'failed';
    a.result = err.message;
    return `Subagent ${a.status}: ${err.message}`;
  }).then(text => {
    a.ended = Date.now();
    saveAgent(a);
    announce(a);
    return text;
  });
  if (!background) return work;
  if (args.notify !== false) work.then(text => {
    enqueue(s, { text: `<background-agent id="${a.id}" description="${a.description}" status="${a.status}">\n${text}\n</background-agent>`, label: `Background agent "${a.description}" ${a.status}.` });
  });
  return `Started background agent ${a.id}. You will be notified when it finishes.`;
}

// ---- compaction ----
export async function compact(s, focus = '') {
  const { state } = s;
  if (!state.items.length) return note(s, 'Nothing to compact.');
  const entry = addEntry(s, { type: 'system', text: 'Compacting conversation…', status: 'running' });
  const signal = s.controller?.signal ?? new AbortController().signal;
  const prompt = `Summarize this conversation so work can continue from the summary alone. Include the user's goals and every explicit instruction, decisions made, files changed and how, current state, errors and fixes, and the exact next steps. Reply with only the summary.${focus ? ` Focus especially on: ${focus}` : ''}`;
  const quiet = { add: e => e, update() {}, delta() {} };
  // Same instructions, tools and key as the turns before it, so the summary request reuses their cache.
  let result;
  try {
    result = await callModel({ model: state.model, effort: 'low', instructions: systemPrompt(s), input: [...state.items, { role: 'user', content: prompt }], tools: await mainTools(s), toolChoice: 'none', cacheKey: s.name }, quiet, signal);
  } catch (err) {
    Object.assign(entry, { text: 'Compaction did not finish. The conversation is unchanged.', status: 'interrupted' });
    send(s, { t: 'entry', entry });
    throw err;
  }
  const { output, usage } = result;
  addUsage(s, usage);
  const summary = output.filter(o => o.type === 'message').flatMap(o => o.content).map(c => c.text || '').join('');
  state.items = [{ role: 'user', content: `This conversation was compacted. Summary of everything so far:\n\n${summary}` }];
  state.gen += 1;
  Object.assign(state.usage, { lastInput: 0, lastCached: 0 });
  Object.assign(entry, { text: 'Conversation compacted.', detail: summary, status: 'done' });
  send(s, { t: 'entry', entry });
  persist(s);
}

// ---- turns ----
function userContent(text, images) {
  if (!images?.length) return text;
  return [{ type: 'input_text', text }, ...images.map(url => ({ type: 'input_image', image_url: url }))];
}

function enqueue(s, msg) {
  s.queue.push(msg);
  if (!s.running && !stopping) startTurn(s);
}

// A checkpoint and rewind position for each prompt, taken before the agent can act on it.
// Only what the user sent gets their injected instructions, not background notices.
async function drainQueue(s) {
  while (s.queue.length) {
    const m = s.queue.shift();
    let { text } = m;
    if (m.entry) {
      const { inject } = promptParts(cwdOf(s), s.state);
      text = withInjection(text, inject);
      Object.assign(m.entry, { queued: false, itemsLen: s.state.items.length, gen: s.state.gen, injected: Boolean(inject) || undefined });
      m.entry.cp = await checkpoint.snapshot(cwdOf(s), m.entry.text.slice(0, 72) || 'prompt');
      send(s, { t: 'entry', entry: m.entry });
      if (s.state.agentSwitch !== undefined) {
        const to = s.state.agentSwitch;
        s.state.items.push({ role: 'user', content: to
          ? `[The user switched this chat to the "${to}" agent. From this message on, work as that agent's instructions in the system prompt describe, and answer as that agent when asked about your role.]`
          : '[The user switched this chat back to the default Nexus agent. From this message on, work as the default system prompt describes.]' });
        delete s.state.agentSwitch;
      }
    } else addEntry(s, { type: 'system', text: m.label });
    s.state.items.push({ role: 'user', content: userContent(text, m.images) });
  }
  persist(s);
}

async function startTurn(s) {
  s.running = true;
  s.controller = new AbortController();
  const { signal } = s.controller;
  status(s);
  const cwd = cwdOf(s);
  const drain = () => drainQueue(s);
  drain.pendingCount = () => s.queue.length;
  try {
    const sink = { ...mainSink(s), persist: () => { persist(s); status(s); } };
    await loop(s, {
      items: () => s.state.items, sink, signal, drain,
      model: () => s.state.model, effort: () => s.state.effort,
      sys: () => systemPrompt(s), tools: () => mainTools(s),
      onUsage: u => { addUsage(s, u); Object.assign(s.state.usage, { lastInput: u?.input_tokens || 0, lastCached: u?.input_tokens_details?.cached_tokens || 0 }); },
      compact: () => compact(s),
    });
    await runHooks('Stop', {}, cwd);
  } catch (err) {
    if (signal.aborted) addEntry(s, { type: 'system', text: stopping ? 'Stopped by a server restart.' : 'Interrupted.' });
    else addEntry(s, { type: 'error', text: err.message });
  } finally {
    // After an interrupt, queued prompts wait in the conversation for the next turn instead of running.
    if (signal.aborted) await drainQueue(s);
    projects.repairItems(s.state.items);
    s.running = false;
    s.controller = null;
    for (const e of s.state.log) if (e.status === 'running') { e.status = 'interrupted'; send(s, { t: 'entry', entry: e }); }
    persist(s);
    status(s);
    if (s.queue.length && !stopping) startTurn(s);
  }
}

// A manual /compact holds the session like a turn, so a prompt sent meanwhile queues instead of being lost when the summary replaces the history.
async function compactTurn(s, focus) {
  s.running = true;
  s.controller = new AbortController();
  const { signal } = s.controller;
  status(s);
  try {
    await compact(s, focus);
  } catch (err) {
    if (!signal.aborted) addEntry(s, { type: 'error', text: err.message });
  } finally {
    s.running = false;
    s.controller = null;
    persist(s);
    status(s);
    if (s.queue.length && !stopping) startTurn(s);
  }
}

// ---- public API, called from the WebSocket ----
export function interrupt(name) { sessions.get(name)?.controller?.abort(); }

export function answer(name, id, value) { sessions.get(name)?.pending.get(id)?.(value); }

const HELP = `**Commands**
\`/clear\` start over (the old transcript is archived in .nexus/history) · \`/compact [focus]\` summarize to free context · \`/autocompact [on|off|tokens]\` compact automatically at a context size · \`/model <id>\` · \`/effort low|medium|high|xhigh\` · \`/mode default|acceptEdits|plan|bypass\` · \`/plan\` · \`/autopilot [on|off]\` keep working without asking, even through a plan · \`/cost\` tokens used · \`/init\` write NEXUS.md · \`/todos\` · \`/help\`

Panels: \`/files\` \`/changes\` \`/terminal\` \`/agents\` \`/settings\` · Hover a prompt to rewind to it.

**Prefixes** \`!cmd\` run a shell command directly · \`#note\` save to NEXUS.md · \`@path\` mention a file

**Keys** Enter send · Shift+Enter newline · Shift+Tab cycle mode · Esc interrupt

Custom commands live in \`.nexus/commands/*.md\` or \`~/.nexus/commands/*.md\` (\`$ARGUMENTS\` is substituted), and every skill is also a command.

**Agents and prompts** \`/create-agent <what it does>\` has the AI write a new agent type · the Agent button next to the model switches this chat to one · the Prompts button edits the system prompt and text injected into every message, for this chat, this project or everywhere.`;

const MODES = ['default', 'acceptEdits', 'plan', 'bypass'];

// Only these come from the page; anything else in the state is the server's.
export function setOption(s, key, value) {
  if (key === 'mode' && !MODES.includes(value)) throw new Error(`Unknown mode ${value}.`);
  else if (key === 'effort' && !['low', 'medium', 'high', 'xhigh', 'max'].includes(value)) throw new Error(`Unknown effort ${value}.`);
  else if (key === 'model' && !/^[\w.:/-]+$/.test(value)) throw new Error('Invalid model id.');
  else if (key === 'agent' && value && !agentDefs(cwdOf(s)).some(d => d.name === value && !d.builtin)) throw new Error(`There is no agent type called ${value}.`);
  else if (key === 'autopilot' && typeof value !== 'boolean') throw new Error('Autopilot is true or false.');
  else if (!['mode', 'effort', 'model', 'agent', 'autopilot'].includes(key)) throw new Error(`Unknown option ${key}.`);
  // The system prompt changes at once, but models lean on recent history, so the switch is also said in the conversation.
  if (key === 'agent' && (value || '') !== (s.state.agent || '')) {
    s.state.agentSwitch = value || '';
    addEntry(s, { type: 'system', text: value ? `Switched to the **${value}** agent.` : 'Switched back to **Nexus**, the default agent.' });
  }
  s.state[key] = value;
  if (key === 'autopilot' && value) for (const resolve of s.pending.values()) resolve({ decision: 'auto' });
  persist(s);
  status(s);
}

// ---- prompts ----
export function getPrompts(name) {
  const s = getSession(name);
  return readPrompts(cwdOf(s), s.state);
}
export function setPrompts(name, scope, value) {
  const s = getSession(name);
  savePrompts(scope, value, cwdOf(s), s.state);
  persist(s);
}
export const previewPrompt = name => systemPrompt(getSession(name));

const createAgentPrompt = (request, cwd) => `Create a new Nexus agent type for this request: ${request}

Write it to ${path.join(cwd, '.nexus', 'agents')}/<name>.md, or to ${path.join(NEXUS_HOME, 'agents')}/<name>.md if the request says it is for every project. Use this format:

---
name: <short-lowercase-name-with-hyphens>
description: <one line: what it does and when to use it>
tools: <comma-separated tool names; leave this line out to allow every tool>
---
<its instructions: the role, how it works step by step, what it must check, and what it reports back>

Tools you can list: Bash, BashOutput, KillShell, Read, Write, Edit, NotebookEdit, Glob, Grep, WebFetch, web_search, TodoWrite, Task, Skill, and any mcp__ tools that are connected. Give it only what it needs: a read-only reviewer gets Read, Glob and Grep.
Look at this project first if that helps tailor the instructions. Don't overwrite an existing agent type unless asked. Finish by saying its name, and that the Agent button next to the model switches this chat to it.`;

function clear(s) {
  if (s.state.log.length) writeAtomic(path.join(cwdOf(s), '.nexus', 'history', `${Date.now()}.json`), JSON.stringify(s.state.log));
  // A fresh conversation drops this chat's own prompts; the project's and global ones stay.
  delete s.state.prompts;
  delete s.state.agentSwitch; // a fresh conversation starts with the agent's prompt, so there is no switch to announce
  Object.assign(s.state, { items: [], log: [], todos: [], gen: s.state.gen + 1 });
  Object.assign(s.state.usage, { lastInput: 0, lastCached: 0 });
  persist(s);
  send(s, { t: 'reset' });
  status(s);
}

async function slash(s, text) {
  const [, cmd, rest = ''] = /^\/(\S+)\s*([\s\S]*)$/.exec(text);
  const arg = rest.trim();
  const cwd = cwdOf(s);
  if (s.running && ['clear', 'compact'].includes(cmd)) return note(s, `Stop the agent before /${cmd}.`, 'error');
  switch (cmd) {
    case 'help': return note(s, HELP);
    case 'clear': return clear(s);
    case 'compact': return compactTurn(s, arg);
    case 'autocompact': {
      const size = /^(\d+)(k?)$/i.exec(arg);
      if (arg === 'off') s.state.autoCompact = 0;
      else if (arg === 'on') delete s.state.autoCompact;
      else if (size) s.state.autoCompact = Math.max(10000, size[1] * (size[2] ? 1000 : 1));
      else if (arg) return note(s, 'Usage: /autocompact [on|off|tokens], for example /autocompact 150k', 'error');
      status(s);
      const at = compactAt(s);
      return note(s, at ? `Auto-compact is on, at ${at.toLocaleString()} tokens of context.` : 'Auto-compact is off. Use /compact when you need it.');
    }
    case 'model': if (arg) setOption(s, 'model', arg); return note(s, `Model: ${s.state.model}`);
    case 'effort': if (arg) setOption(s, 'effort', arg); return note(s, `Effort: ${s.state.effort}`);
    case 'mode': if (arg) setOption(s, 'mode', arg); return note(s, `Permission mode: ${s.state.mode}`);
    case 'plan': setOption(s, 'mode', 'plan'); return note(s, 'Plan mode on. The agent can research but not change anything.');
    case 'autopilot':
      if (arg === 'on' || arg === 'off') setOption(s, 'autopilot', arg === 'on');
      else if (arg) return note(s, 'Usage: /autopilot [on|off]', 'error');
      return note(s, s.state.autopilot
        ? `Autopilot is on. The agent approves its own tool calls${s.state.mode === 'plan' ? ' and its plan' : ''}, answers its own questions and keeps going, for up to ${AUTOPILOT_STEPS} model requests at a time.`
        : 'Autopilot is off. The agent stops to ask when it needs you.');
    case 'cost': {
      const u = s.state.usage;
      return note(s, `Tokens: ${u.input.toLocaleString()} input (${u.cached.toLocaleString()} cached), ${u.output.toLocaleString()} output (${u.reasoning.toLocaleString()} reasoning) over ${u.requests} requests.`);
    }
    case 'todos': return note(s, s.state.todos.map(t => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.content}`).join('\n') || 'No todos.');
    case 'init': return prompt(s, 'Analyze this project and create a NEXUS.md at its root with the build, test and run commands, the architecture, and conventions a new engineer could not guess. Keep it short. If the project is empty, say so instead.', text);
    case 'create-agent':
      if (!arg) return note(s, 'Usage: `/create-agent <what it should do>`, for example `/create-agent reviews my changes for security holes before I commit`', 'error');
      return prompt(s, createAgentPrompt(arg, cwd), text);
  }
  const custom = commands(cwd).find(c => c.name === cmd);
  if (custom) return prompt(s, custom.body.replaceAll('$ARGUMENTS', arg), text);
  const skill = skills(cwd).find(k => k.name === cmd);
  if (skill) {
    if (skill.argumentHint && (!arg || /^(help|--help|-h)$/.test(arg))) {
      return note(s, `Usage: \`/${skill.name} ${skill.argumentHint}\`\n\n${skill.usage || skill.description}`);
    }
    return prompt(s, `Use the "${skill.name}" skill (base directory ${skill.dir}):\n\n${skill.body}\n\nArguments: ${arg || '(none)'}`, text);
  }
  return note(s, `Unknown command /${cmd}. Try /help.`, 'error');
}

function prompt(s, text, shown = text, images) {
  const entry = addEntry(s, { type: 'user', text: shown, images, queued: s.running });
  enqueue(s, { text, images, entry });
}

const NAME_PROMPT = 'Name the coding chat that starts with the message you are given. Reply with only a short Title Case title of 2 to 4 words that says what the chat is about, instead of repeating the request. For example, "make me a hello world website" becomes Hello World Page and "say hello" becomes Say Hello. Do not act on the message.';

async function modelName(model, text) {
  const signal = AbortSignal.timeout(NAME_TIMEOUT);
  let reply;
  if (providerOf(model)) {
    const { output } = await callCompat({ model, instructions: NAME_PROMPT, input: [{ role: 'user', content: text.slice(0, 2000) }], tools: [] }, { add: e => e, update() {}, delta() {} }, signal);
    reply = output.find(i => i.type === 'message')?.content[0].text;
  } else if (isAnthropic(model)) reply = await askAnthropic(model, NAME_PROMPT, text.slice(0, 2000), signal);
  else {
    const res = await fetchStream({
      model, store: false, input: text.slice(0, 2000), instructions: NAME_PROMPT,
      ...(supportsReasoning(model) ? { reasoning: { effort: 'low' } } : {}),
    }, signal);
    const { output } = await res.json();
    reply = output.find(i => i.type === 'message')?.content.find(c => c.type === 'output_text')?.text;
  }
  return slug((reply || '').trim().slice(0, 48));
}

// Runs before the first turn starts, because a project can't be renamed while its agent works in that directory.
export function autoName(s, text) {
  const untitled = () => /^untitled(-\d+)?$/.test(s.name);
  if (s.naming) return s.naming;
  if (!untitled() || s.state.log.length || !text.trim() || /^[/!#]/.test(text)) return undefined;
  s.naming = (async () => {
    const base = await modelName(s.state.model, text).catch(() => '') || slug(text.split(/\s+/).slice(0, 6).join('-').slice(0, 48));
    if (!base || !untitled()) return;
    let name = base;
    for (let n = 2; projects.exists(name); n++) name = `${base}-${n}`;
    try { renameProject(s.name, name); } catch { /* keep the untitled name */ }
  })().finally(() => { s.naming = null; });
  return s.naming;
}

export function renameProject(from, to) {
  if (from !== to && isBusy(from)) throw projects.httpError(409, 'This project is busy. Stop its agents and shells before renaming.');
  projects.rename(from, to);
  const s = sessions.get(from);
  if (s) { sessions.delete(from); s.name = to; sessions.set(to, s); }
  for (const a of agents.values()) if (a.project === from) a.project = to;
  for (const sh of shells.values()) if (sh.project === from) sh.project = to;
  hub.emit('renamed', from, to);
}

export function selfProject() {
  const link = projects.projectDir(projects.SELF);
  if (!fs.existsSync(link)) {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(REPO, link, process.platform === 'win32' ? 'junction' : 'dir');
    setOption(getSession(projects.SELF), 'mode', 'bypass');
  }
  return projects.SELF;
}

// scripts/self-restart.sh leaves this behind when it had to revert a change.
// A restart stops running work where it is, and the next process picks it back up.
let stopping = false;
const resumeMark = name => path.join(projects.projectDir(name), '.nexus', 'resume');
const RESUME = 'The Nexus server restarted while you were working, which stopped your last step and any background shells and subagents. Check what actually finished, then carry on with the task. Do not restart or redeploy the server again unless the task still needs it.';

export async function stopForRestart() {
  stopping = true;
  const running = a => a.status === 'running';
  const busy = [...sessions.values()].filter(s => s.running || [...agents.values()].some(a => a.project === s.name && running(a)));
  for (const s of busy) fs.writeFileSync(resumeMark(s.name), '');
  for (const a of agents.values()) if (running(a)) a.controller?.abort();
  for (const s of busy) s.controller?.abort();
  while (busy.some(s => s.running)) await new Promise(r => setTimeout(r, 50));
}

export function resumeAfterRestart() {
  for (const { name } of projects.list()) {
    if (!fs.existsSync(resumeMark(name))) continue;
    fs.rmSync(resumeMark(name)); // first, so a crash here can't resume forever
    enqueue(getSession(name), { text: RESUME, label: 'Server restarted. Continuing where it stopped.' });
  }
}

export function reportFailedDeploy() {
  const file = path.join(REPO, 'data', 'self-deploy-failed.txt');
  if (!fs.existsSync(file)) return;
  note(getSession(selfProject()), fs.readFileSync(file, 'utf8'), 'error');
  fs.rmSync(file);
}

export function trashProject(name) {
  if (isBusy(name)) throw projects.httpError(409, 'This project is busy. Stop its agents and shells before deleting.');
  projects.trash(name);
  sessions.delete(name);
  for (const [id, a] of agents) if (a.project === name) agents.delete(id);
  for (const [id, sh] of shells) if (sh.project === name) shells.delete(id);
}

export async function submit(name, text, images) {
  const s = getSession(name);
  await autoName(s, text);
  const hook = await runHooks('UserPromptSubmit', { prompt: text }, cwdOf(s));
  if (hook.blocked) return note(s, `Prompt blocked: ${hook.reason}`, 'error');
  try {
    if (text.startsWith('/') && !images?.length) return await slash(s, text);
    if (text.startsWith('!')) return await direct(s, text.slice(1).trim());
    if (text.startsWith('#')) {
      fs.appendFileSync(path.join(cwdOf(s), 'NEXUS.md'), `- ${text.slice(1).trim()}\n`);
      return note(s, 'Saved to NEXUS.md.');
    }
    prompt(s, text, text, images);
  } catch (err) {
    note(s, err.message, 'error');
  }
}

async function direct(s, command) {
  if (s.running) return note(s, 'Stop the agent before running a shell command directly.', 'error');
  const cwd = cwdOf(s);
  const entry = addEntry(s, { type: 'tool', name: 'Bash', args: { command }, status: 'running', output: '', direct: true });
  const output = await execTool('Bash', { command }, { cwd, session: s, progress: t => { entry.output += t; send(s, { t: 'delta', id: entry.id, kind: 'output', text: t }); } });
  Object.assign(entry, { status: 'done', output });
  send(s, { t: 'entry', entry });
  s.state.items.push({ role: 'user', content: `I ran this shell command myself:\n$ ${command}\n${output}` });
  persist(s);
}

export async function rewind(name, id, { files = true, conversation = true }) {
  const s = getSession(name);
  if (s.running) throw projects.httpError(409, 'Stop the agent before rewinding.');
  const i = s.state.log.findIndex(e => e.id === id && e.type === 'user');
  if (i < 0) throw projects.httpError(404, 'That prompt no longer exists.');
  const entry = s.state.log[i];
  if (files) {
    if (!entry.cp) throw projects.httpError(409, 'That prompt has no file checkpoint.');
    await checkpoint.restore(cwdOf(s), entry.cp);
  }
  if (conversation) {
    if (entry.gen !== s.state.gen) throw projects.httpError(409, 'The conversation was compacted after this prompt, so only its files can be rewound.');
    s.state.items.length = Math.min(s.state.items.length, entry.itemsLen);
    s.state.log.length = i;
    persist(s);
    send(s, { t: 'reset', state: publicState(s) });
  }
  return { text: entry.text };
}

// The transcript as Markdown: messages in full, tool calls folded with their output clipped.
export function exportMarkdown(name) {
  const s = getSession(name);
  const fence = text => {
    const ticks = '`'.repeat(Math.max(3, ...[...String(text).matchAll(/`+/g)].map(m => m[0].length + 1)));
    return `${ticks}\n${text}\n${ticks}`;
  };
  const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const target = a => String(a?.command ?? a?.file_path ?? a?.pattern ?? a?.url ?? a?.description ?? a?.query ?? '').split('\n')[0].slice(0, 120);
  const out = [`# ${name}`, `Exported from Nexus on ${new Date().toISOString().slice(0, 10)} · model ${s.state.model}${s.state.agent ? ` · agent ${s.state.agent}` : ''}`];
  for (const e of s.state.log) {
    if (e.type === 'user') out.push(`## You\n\n${e.text}`);
    else if (e.type === 'assistant') out.push(`## Nexus\n\n${e.text}`);
    else if (e.type === 'tool') out.push(`<details><summary>${esc(e.name)} ${esc(target(e.args))}</summary>\n\n${fence(JSON.stringify(e.args ?? {}, null, 2))}${e.output ? `\n\n${fence(clip(e.output, 4000))}` : ''}\n\n</details>`);
    else if (e.type === 'error') out.push(`> **Error:** ${e.text}`);
    else if (e.type === 'system') out.push(`> ${String(e.text).replace(/\n/g, '\n> ')}`);
  }
  return `${out.join('\n\n')}\n`;
}

export async function changes(name) {
  const s = getSession(name);
  const last = [...s.state.log].reverse().find(e => e.type === 'user' && e.cp);
  if (!last) return { since: null, diff: '' };
  return { since: last.text.slice(0, 80), diff: await checkpoint.diff(cwdOf(s), last.cp) };
}

export { killGroup, shells };
