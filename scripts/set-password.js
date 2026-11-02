// Usage: node scripts/set-password.js <user> <password>  (writes a scrypt hash into .env)
import { randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
const args = process.argv.slice(2);
const windows = args[0] === '--windows' || (args[0] !== '--linux' && process.platform === 'win32');
if (args[0] === '--windows' || args[0] === '--linux') args.shift();
const file = new URL(windows ? '../windows/.env' : '../.env', import.meta.url);

try {
	if (args[0] === '--status') {
		if (fs.existsSync(file)) process.loadEnvFile(file);
		console.log(JSON.stringify({
			configured: Boolean(process.env.NEXUS_USER && process.env.NEXUS_PASS_HASH),
			user: process.env.NEXUS_USER || '', port: Number(process.env.NEXUS_PORT) || 7711,
			openai: Boolean(process.env.OPENAI_API_KEY), anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
		}));
		process.exit(0);
	}
	const stdin = args[0] === '--stdin';
	const input = stdin ? JSON.parse(fs.readFileSync(0, 'utf8')) : { user: args[0], pass: args[1] };
	const { user, pass } = input;
	if (typeof user !== 'string' || !user.trim() || (!stdin && !pass)) throw new Error('Usage: set-password.js [--windows] <user> <password>, or --stdin.');
	if (pass !== undefined && typeof pass !== 'string') throw new Error('Password must be text.');
	const value = text => {
		if (typeof text !== 'string' || /[\r\n\0"]/.test(text)) throw new Error('Settings must be single-line text without double quotes.');
		return `"${text}"`;
	};
	const updates = new Map([['NEXUS_USER', value(user.trim())]]);
	if (pass) {
		const salt = randomBytes(16).toString('hex');
		updates.set('NEXUS_PASS_HASH', value(`${salt}:${scryptSync(pass, salt, 64).toString('hex')}`));
	}
	const allowed = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NEXUS_PORT', 'NEXUS_PROJECTS', 'NEXUS_AUTO_UPDATE', 'SHELL'];
	for (const key of allowed) if (Object.hasOwn(input.settings || {}, key)) {
		const text = input.settings[key];
		if (key === 'NEXUS_PORT' && (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 65535)) throw new Error('Port must be between 1 and 65535.');
		updates.set(key, value(text));
	}
	const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
	if (!pass && !existing.some(line => /^NEXUS_PASS_HASH=/.test(line))) throw new Error('A password is required for the first setup.');
	const kept = existing.filter(line => line && !updates.has(/^\s*([\w]+)\s*=/.exec(line)?.[1]));
	fs.mkdirSync(new URL('.', file), { recursive: true });
	fs.writeFileSync(file, [...kept, ...[...updates].map(([key, text]) => `${key}=${text}`), ''].join('\n'), { mode: 0o600 });
	console.log('.env updated');
} catch (err) {
	console.error(err.message);
	process.exitCode = 1;
}
