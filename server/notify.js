import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSettings } from './util.js';

// Notifications from the computer itself, outside the browser: a Windows toast shown by the launcher,
// macOS Notification Center, or notify-send on a Linux desktop. Phones get Web Push (push.js) instead.
const LAUNCHER = fileURLToPath(new URL('../windows/Nexus.exe', import.meta.url));
const ICON = fileURLToPath(new URL('../public/icon-180.png', import.meta.url));

// The command that shows one notification here, or null where there's nowhere to show it.
export function notifyCommand(platform, title, body, url, env = process.env) {
  if (platform === 'win32') return [LAUNCHER, ['--notify', title, body, url]];
  if (platform === 'darwin') return ['osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', title, body]];
  // A Linux server without a desktop session (a VPS, a system service) has no screen to show it on.
  if (env.DISPLAY || env.WAYLAND_DISPLAY || env.DBUS_SESSION_BUS_ADDRESS) return ['notify-send', ['--app-name=Nexus', `--icon=${ICON}`, '--', title, body]];
  return null;
}

let found;
export const available = () => (found ??= process.platform === 'win32' ? fs.existsSync(LAUNCHER)
  : process.platform === 'darwin' || (Boolean(notifyCommand('linux', '', '', '')) && spawnSync('notify-send', ['--version']).status === 0));
// settings.json "desktopNotify": false turns them off.
export const enabled = () => available() && readSettings().desktopNotify !== false;

export function desktopNotify(title, body, url) {
  const cmd = enabled() && notifyCommand(process.platform, title, body, url);
  if (cmd) execFile(cmd[0], cmd[1], { timeout: 30000 }, err => { if (err && !err.killed) console.error('Desktop notification:', err.message); });
}
