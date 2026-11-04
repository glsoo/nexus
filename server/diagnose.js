import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseJsonc } from './vscode.js';

// Right after the agent writes or edits a file, a quick check that it still parses, so a broken file is fixed in the same
// step instead of being found later. Only checks that are fast and sure: JavaScript (node --check), JSON (comments allowed,
// as in tsconfig.json) and Python (its own parser).
const problemOf = (cmd, args) => promisify(execFile)(cmd, args, { timeout: 15000, windowsHide: true })
  .then(() => '', err => (err.code === 'ENOENT' || err.killed ? '' : String(err.stderr || err.stdout || err.message)));
const moduleProblem = text => new Promise(resolve => {
  const p = spawn(process.execPath, ['--input-type=module', '--check'], { windowsHide: true, timeout: 15000 });
  let err = '';
  p.stderr.on('data', d => (err += d));
  p.on('error', () => resolve(''));
  p.on('close', code => resolve(code ? err : ''));
  p.stdin.on('error', () => {});
  p.stdin.end(text);
});
let python; // the Python command that works here, or '' when there's none (Windows' Store placeholder doesn't count)
const findPython = async () => {
  if (python !== undefined) return python;
  for (const cmd of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
    const ok = await promisify(execFile)(cmd, ['-c', 'import ast'], { timeout: 10000, windowsHide: true }).then(() => true, () => false);
    if (ok) return (python = cmd);
  }
  return (python = '');
};

export async function syntax(file) {
  const ext = path.extname(file).toLowerCase();
  let problem = '';
  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    const text = fs.readFileSync(file, 'utf8');
    // node --check passes a .js file with import or export whatever its syntax, so such a file is checked as a module from stdin.
    problem = ext === '.js' && /^\s*(import|export)\b/m.test(text) ? (await moduleProblem(text)).replaceAll('[stdin]', file) : await problemOf(process.execPath, ['--check', file]);
    if (/Unexpected token '<'/.test(problem)) problem = ''; // JSX, which plain JavaScript can't parse
  } else if (ext === '.json') {
    try { parseJsonc(fs.readFileSync(file, 'utf8')); } catch (err) { problem = `${file}: ${err.message}`; }
  } else if (ext === '.py' && await findPython()) {
    problem = await problemOf(python, ['-c', 'import ast, sys; ast.parse(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1])', file]);
  }
  problem = problem.trim();
  return problem ? `\n\nThe file doesn't parse now:\n${problem.length > 2000 ? `${problem.slice(0, 2000)}…` : problem}\nFix this before going on.` : '';
}

// After a turn that changed code in a TypeScript project (a tsconfig.json and its own typescript package), tsc checks it.
// The errors that count: those in files the turn changed, plus any that weren't there at this chat's previous check.
export async function typeErrors(cwd, changed, seen, signal) {
  const bin = path.join(cwd, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!fs.existsSync(path.join(cwd, 'tsconfig.json')) || !fs.existsSync(bin)) return null;
  const out = await promisify(execFile)(process.execPath, [bin, '--noEmit', '--pretty', 'false'], { cwd, signal, timeout: 300_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true })
    .then(r => r.stdout, err => { if (signal?.aborted) throw err; return String(err.stdout || err.message); });
  const all = out.split(/\r?\n/).filter(l => /error TS\d+:/.test(l));
  const key = l => l.replace(/\(\d+,\d+\)/, '').replaceAll('\\', '/');
  const touched = l => changed.some(f => key(l).startsWith(`${f}:`));
  const counted = all.filter(l => touched(l) || (seen && !seen.has(key(l))));
  return { all, counted, seen: new Set(all.map(key)) };
}
