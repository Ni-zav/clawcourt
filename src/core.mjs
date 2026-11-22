import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export const COMMANDS = Object.freeze({
  none: null,
  node_test: { cmd: 'node', args: ['--test'] },
  npm_test: { cmd: 'npm', args: ['test'] },
  npm_build: { cmd: 'npm', args: ['run', 'build'] },
  git_diff_check: { cmd: 'git', args: ['diff', '--check'] },
  python_pytest: { cmd: 'python', args: ['-m', 'pytest', '-q'] },
  go_test: { cmd: 'go', args: ['test', './...'] },
  cargo_test: { cmd: 'cargo', args: ['test'] }
});
export const VALID_MODES = Object.freeze(['demo-fail','demo-pass','openclaw']);
const MAX_STRING = 3000;

export function redact(input) {
  return String(input ?? '')
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[REDACTED_API_KEY]')
    .replace(/((?:api[_-]?key|authorization|token|password)\s*[:=]\s*)["']?[^\s,"']+/gi, '$1[REDACTED]')
    .slice(0, 14000);
}

export function normalizeRequest(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid request body');
  const text = (value, label, required=false) => {
    if (typeof value !== 'string' || value.length > MAX_STRING || (required && !value.trim())) throw new Error(`Invalid ${label}`);
    return value.trim();
  };
  const mode = text(raw.mode ?? 'demo-fail', 'mode', true);
  if (!VALID_MODES.includes(mode)) throw new Error('Invalid execution mode');
  const task = text(raw.task ?? '', 'task', true);
  const file = text(raw.file ?? 'incident.txt', 'file', true);
  const expected = text(raw.expected ?? 'status=fixed', 'expected', true);
  const command = text(raw.command ?? 'node_test', 'command', true);
  if (!(command in COMMANDS)) throw new Error('Command is not approved');
  if (path.isAbsolute(file) || file.includes('\\') || file.split('/').includes('..') || file.startsWith('.')) {
    throw new Error('Use a relative workspace file path without traversal');
  }
  return { mode, task, file, expected, command };
}

/** Snapshot file fingerprints only, never full file contents. Symlinks outside workspace are rejected. */
export async function snapshotFile(workspace, file) {
  const root = await fs.realpath(workspace);
  const target = path.resolve(root, file);
  if (!(target === root || target.startsWith(root + path.sep))) throw new Error('Path escaped workspace');
  try {
    const real = await fs.realpath(target);
    if (!(real === root || real.startsWith(root + path.sep))) throw new Error('Symlink escaped workspace');
    const stat = await fs.stat(real);
    if (!stat.isFile()) return {exists: false};
    const data = await fs.readFile(real);
    return {exists: true, sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length};
  } catch (err) {
    if (err.code === 'ENOENT') return {exists: false};
    throw err;
  }
}

export async function verifyFile({ workspace, file, expected }) {
  const target = path.resolve(workspace, file);
  const root = await fs.realpath(workspace);
  if (!(target === root || target.startsWith(root + path.sep))) throw new Error('Path escaped workspace');
  try {
    const real = await fs.realpath(target);
    if (!(real === root || real.startsWith(root + path.sep))) throw new Error('Symlink escaped workspace');
    const stats = await fs.stat(real);
    if (!stats.isFile()) return [
      { label: 'Target is a regular file', passed: false, detail: file },
      { label: 'Expected evidence exists in file', passed: false, detail: 'Not a regular file' }
    ];
    const content = (await fs.readFile(real, 'utf8')).slice(0, 2_000_000);
    return [
      { label: 'Target file exists', passed: true, detail: file },
      { label: 'Expected evidence found in file', passed: content.includes(expected), detail: content.includes(expected) ? `Matched ${JSON.stringify(expected)}` : `Missing ${JSON.stringify(expected)}` }
    ];
  } catch (err) {
    if (err.code === 'ENOENT') return [
      { label: 'Target file exists', passed: false, detail: `${file} not found` },
      { label: 'Expected evidence found in file', passed: false, detail: 'File missing' }
    ];
    throw err;
  }
}

export function spawnBounded(executable, args, { cwd, timeoutMs = 30000, stdin, signal } = {}) {
  return new Promise((resolve) => {
    let output = '', error = '', settled = false, timedOut = false;
    let child;
    try {
      child = spawn(executable, args, {cwd, shell: false, stdio: ['pipe','pipe','pipe'], env: process.env, signal});
    } catch (err) {
      resolve({exitCode: -1, stdout:'', stderr:err.message, timedOut:false}); return;
    }
    let timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.on('data', chunk => { output = (output + String(chunk)).slice(-500_000); });
    child.stderr.on('data', chunk => { error = (error + String(chunk)).slice(-100_000); });
    child.on('error', err => { error += '\n'+err.message; });
    child.on('close', code => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({exitCode: code ?? -1, stdout:output, stderr:error, timedOut});
    });
    if (stdin != null) child.stdin.end(stdin); else child.stdin.end();
  });
}

export async function verifyCommand(workspace, command) {
  if (command === 'none') return [];
  const entry = COMMANDS[command];
  if (!entry) throw new Error('Unsupported verification command');
  const outcome = await spawnBounded(entry.cmd, entry.args, {cwd:workspace, timeoutMs: 30000});
  return [{
    label: `Independent command: ${entry.cmd} ${entry.args.join(' ')}`,
    passed: outcome.exitCode === 0 && !outcome.timedOut,
    detail: redact((outcome.stdout + '\n' + outcome.stderr).trim()).slice(-4200) || `Exit ${outcome.exitCode}`,
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut
  }];
}

export async function verifyAcceptance(workspace, spec) {
  const results = [
    ...(await verifyFile({workspace, file: spec.file, expected: spec.expected})),
    ...(await verifyCommand(workspace, spec.command))
  ];
  return { results, passed: results.length > 0 && results.every(r => r.passed), count: results.filter(r=>r.passed).length, total: results.length };
}

export function parseOpenclaw(stdout, exitCode) {
  let data;
  try { data = JSON.parse(stdout); } catch { throw new Error('OpenClaw did not return JSON. Check your installed CLI version.'); }
  const ok = exitCode === 0 && data.ok !== false && data.status !== 'error' && data.status !== 'timeout' && !data.error;
  const answer = data.final ?? data.payloads?.map(x=>x.text).filter(Boolean).join('\n') ?? data.result?.payloads?.map(x=>x.text).filter(Boolean).join('\n') ?? '';
  return {
    ok, answer: redact(answer),
    usage: data.usage ?? data.meta?.agentMeta?.usage ?? null,
    model: data.model ?? data.meta?.agentMeta?.model ?? null,
    provider: data.provider ?? data.meta?.agentMeta?.provider ?? null,
    error: data.error?.message ? redact(data.error.message) : null
  };
}

export function gradeRun(agent, acceptance) {
  if (!agent.ok) return 'agent_failed';
  return acceptance.passed ? 'verified' : 'unverified';
}
