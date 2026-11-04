import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { childEnv } from './util.js';

// Source control for a project's folder, for the Changes tab: status, commit, branches, history, pull and push.
// Nobody can answer a password prompt here, so those fail at once instead of hanging.
const run = (cwd, args, timeout = 60_000) => promisify(execFile)('git', args, {
  cwd, timeout, windowsHide: true, maxBuffer: 20 * 1024 * 1024,
  env: { ...childEnv(), GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes' },
}).then(r => r.stdout, err => { throw Object.assign(new Error((err.stderr || err.message).trim().split('\n').slice(-3).join(' ') || 'git failed.'), { status: 400 }); });
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n[cut at ${n} characters]` : s);

export async function overview(cwd) {
  try { await run(cwd, ['rev-parse', '--is-inside-work-tree']); } catch { return { repo: false }; }
  const lines = (await run(cwd, ['status', '--porcelain=v1', '-b', '--untracked-files=all'])).split('\n').filter(Boolean);
  const head = lines.shift() || '';
  const [, branch = '', upstream = ''] = /^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?/.exec(head) || [];
  const ahead = Number(/ahead (\d+)/.exec(head)?.[1] || 0), behind = Number(/behind (\d+)/.exec(head)?.[1] || 0);
  const files = lines.map(l => ({ status: l.slice(0, 2).trim() || '?', path: l.slice(3).replace(/^"|"$/g, '') })).filter(f => !f.path.startsWith('.nexus/'));
  const branches = (await run(cwd, ['branch', '--format=%(refname:short)'])).split('\n').filter(Boolean);
  let log = [];
  try {
    log = (await run(cwd, ['log', '-30', '--format=%h%x00%an%x00%ar%x00%s'])).split('\n').filter(Boolean).map(l => { const [hash, author, when, subject] = l.split('\0'); return { hash, author, when, subject }; });
  } catch { /* no commits yet */ }
  return { repo: true, branch, upstream, ahead, behind, files, branches, log };
}

export const show = async (cwd, hash) => {
  if (!/^[0-9a-f]{4,40}$/.test(String(hash))) throw Object.assign(new Error('Not a commit.'), { status: 400 });
  return run(cwd, ['show', '--stat', '--patch', '--format=%H%n%an, %ad%n%n%B', hash]).then(out => clip(out, 200_000));
};

// What a commit would include, for writing its message.
export async function pending(cwd) {
  const stat = await run(cwd, ['diff', 'HEAD', '--stat']).catch(() => '');
  const diff = await run(cwd, ['diff', 'HEAD']).catch(() => run(cwd, ['diff', '--cached']).catch(() => ''));
  const untracked = (await run(cwd, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(f => f && !f.startsWith('.nexus/'));
  return `${stat}${untracked.length ? `\nNew files:\n${untracked.join('\n')}\n` : ''}\n${clip(diff, 30_000)}`;
}

const branchName = async (cwd, name) => {
  name = String(name || '').trim();
  if (!name || name.startsWith('-')) throw Object.assign(new Error('Give the branch a name.'), { status: 400 });
  await run(cwd, ['check-ref-format', '--branch', name]).catch(() => { throw Object.assign(new Error(`"${name}" isn't a valid branch name.`), { status: 400 }); });
  return name;
};

export async function act(cwd, { action, message, branch }) {
  if (action === 'commit') {
    if (!String(message || '').trim()) throw Object.assign(new Error('Write a commit message first.'), { status: 400 });
    await run(cwd, ['add', '-A', '--', '.', ':!.nexus']);
    return run(cwd, ['commit', '-q', '-m', String(message).trim()]);
  }
  if (action === 'switch') return run(cwd, ['switch', await branchName(cwd, branch)]);
  if (action === 'create') return run(cwd, ['switch', '-c', await branchName(cwd, branch)]);
  if (action === 'pull') return run(cwd, ['pull', '--ff-only'], 120_000);
  if (action === 'push') {
    const upstream = await run(cwd, ['rev-parse', '--abbrev-ref', '@{u}']).catch(() => '');
    return run(cwd, upstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'], 120_000);
  }
  throw Object.assign(new Error('Unknown action.'), { status: 400 });
}
