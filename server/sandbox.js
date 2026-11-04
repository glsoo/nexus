import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME, readSettings } from './util.js';

// settings.json "sandbox": true runs the agent's shell commands where they can only write inside the chat's folders, the
// temp folder and package caches (bubblewrap on Linux, sandbox-exec on macOS), so a bad command in bypass or on autopilot
// can't touch the rest of the computer. "sandboxNetwork": false cuts the network too. Commands you run yourself (!cmd, /check)
// aren't sandboxed. With no sandbox here (Windows, or Linux without bwrap) the agent's commands are refused rather than run
// unconfined, so turning it on never silently does nothing.
// shortcut: reads stay open everywhere (toolchains live in the home folder), so with the network on a command could still
// send a file it reads; turn the network off for that.
const onPath = name => (process.env.PATH || '').split(path.delimiter).map(d => path.join(d, name)).find(f => fs.existsSync(f));
export function available() {
  if (process.platform === 'linux') return onPath('bwrap') ? 'bubblewrap' : null;
  if (process.platform === 'darwin') return fs.existsSync('/usr/bin/sandbox-exec') ? 'sandbox-exec' : null;
  return null;
}
export const enabled = () => readSettings().sandbox === true;

const real = p => { try { return fs.realpathSync.native(p); } catch { return null; } };
function writable(dirs) {
  const extra = readSettings().sandboxWritable;
  const caches = ['.npm', '.cache', '.yarn', '.pnpm-store', path.join('.local', 'share', 'pnpm'), path.join('.cargo', 'registry'), path.join('go', 'pkg')].map(d => path.join(HOME, d));
  const asked = (Array.isArray(extra) ? extra : []).map(String).map(d => path.resolve(HOME, d.replace(/^~(?=$|[\\/])/, HOME)));
  return [...new Set([...dirs, os.tmpdir(), ...caches, ...asked].map(real).filter(Boolean))];
}

// The command to spawn in place of shell + args.
export function wrap(shell, args, dirs, { platform = process.platform, network = readSettings().sandboxNetwork !== false, tool = available() } = {}) {
  if (!tool) throw new Error(`The sandbox is on in Settings, but ${platform === 'linux' ? 'bubblewrap (bwrap) is not installed. Install it (apt install bubblewrap) or' : 'this system has none. Nexus sandboxes commands on Linux and macOS, so'} turn the sandbox off in Settings to run commands.`);
  const paths = writable(dirs);
  if (platform === 'linux') {
    return [onPath('bwrap') || 'bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', ...paths.flatMap(d => ['--bind-try', d, d]),
      '--die-with-parent', ...(network ? [] : ['--unshare-net']), '--', shell, ...args]];
  }
  const profile = `(version 1)(allow default)(deny file-write*)(allow file-write* ${paths.map(d => `(subpath ${JSON.stringify(d)})`).join(' ')} (literal "/dev/null") (literal "/dev/tty") (regex #"^/dev/fd/"))${network ? '' : '(deny network*)'}`;
  return ['/usr/bin/sandbox-exec', ['-p', profile, shell, ...args]];
}
