const file = new URL(process.platform === 'win32' ? '../windows/.env' : '../.env', import.meta.url);
process.loadEnvFile(file);
await import('../server/index.js');