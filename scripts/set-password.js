// Usage: node scripts/set-password.js <user> <password>  (writes a scrypt hash into .env)
import { randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
const [user, pass] = process.argv.slice(2);
if (!user || !pass) { console.error('usage: set-password.js <user> <password>'); process.exit(1); }
const salt = randomBytes(16).toString('hex');
const hash = `${salt}:${scryptSync(pass, salt, 64).toString('hex')}`;
const file = new URL('../.env', import.meta.url);
const kept = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(l => l && !/^NEXUS_(USER|PASS_HASH)=/.test(l)) : [];
fs.writeFileSync(file, [...kept, `NEXUS_USER=${user}`, `NEXUS_PASS_HASH=${hash}`, ''].join('\n'), { mode: 0o600 });
console.log('.env updated');
