import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readJson, writeAtomic } from './util.js';

const scryptAsync = promisify(scrypt);
const SESSION_MS = 30 * 24 * 3600 * 1000;
const FILE = fileURLToPath(new URL('../data/sessions.json', import.meta.url));
const sha = s => createHash('sha256').update(s).digest();
const sessions = new Map(Object.entries(readJson(FILE, {})));

export async function verifyPassword(user, pass) {
  const [salt, hash] = (process.env.NEXUS_PASS_HASH || ':').split(':');
  // Always hash, so a wrong username takes as long as a wrong password.
  const got = await scryptAsync(String(pass), salt || 'x', 64);
  const want = Buffer.from(hash || '', 'hex');
  const passOk = want.length === got.length && timingSafeEqual(got, want);
  const userOk = timingSafeEqual(sha(String(user)), sha(process.env.NEXUS_USER || ''));
  return Boolean(process.env.NEXUS_USER) && passOk && userOk;
}

const persist = () => writeAtomic(FILE, JSON.stringify(Object.fromEntries(sessions)));

export function createSession() {
  const token = randomBytes(32).toString('base64url');
  sessions.set(sha(token).toString('hex'), Date.now() + SESSION_MS);
  persist();
  return token;
}

export function validSession(token) {
  if (!token) return false;
  const key = sha(token).toString('hex');
  const expires = sessions.get(key);
  if (expires > Date.now()) return true;
  if (expires) { sessions.delete(key); persist(); }
  return false;
}

// Push subscriptions remember the session that made them, by this key, and stop once it ends.
export const sessionKey = token => sha(String(token || '')).toString('hex');
export const liveSessionKey = key => sessions.get(key) > Date.now();
export function endSession(token) {
  if (token && sessions.delete(sha(token).toString('hex'))) persist();
}

// Failed logins: 5 per IP in 15 minutes, 30 overall per hour, so rotating IPs can't grind the password either.
// ponytail: in memory, so a restart clears the counters.
const fails = [];
export function loginBlocked(ip, now = Date.now()) {
  while (fails.length && fails[0].at < now - 3600_000) fails.shift();
  return fails.length >= 30 || fails.filter(f => f.ip === ip && f.at > now - 900_000).length >= 5;
}
export const recordFail = (ip, now = Date.now()) => { const f = { ip, at: now }; fails.push(f); return f; };
export const forgive = f => { const i = fails.indexOf(f); if (i >= 0) fails.splice(i, 1); };
export const clearFails = () => { fails.length = 0; };
