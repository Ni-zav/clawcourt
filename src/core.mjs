import fs from 'node:fs/promises';
import { constants } from 'node:fs';
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
export const DEMO_MODES = ['demo-fail', 'demo-pass', 'demo-agent-failed'];
const MAX_FILE_BYTES = 2_000_000;

export function redact(input) {
  return String(input ?? '')
    .replace(/\b(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{12,}/gi, '[REDACTED]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '[REDACTED]')
    .replace(/((?:api[_-]?key|authorization|token|password)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;"']+)/gi, '$1[REDACTED]')
    .slice(0, 14000);
}

function fileParts(file) {
  const parts = file.split('/');
  if (path.isAbsolute(file) || /[\\:\x00-\x1f\x7f]/.test(file) ||
      parts.some(part => !part || part.startsWith('.'))) {
    throw new Error('Use a relative workspace file path without traversal or hidden components');
  }
  return parts;
}

export function normalizeRequest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid request body');
  const text = (value, label, max = 3000) => {
    if (typeof value !== 'string' || value.length > max || !value.trim()) throw new Error(`Invalid ${label}`);
    return value;
  };
  const mode = text(raw.mode ?? 'demo-fail', 'mode');
  if (![...DEMO_MODES, 'openclaw', 'verify'].includes(mode)) throw new Error('Invalid execution mode');
  const task = text(raw.task ?? (mode === 'verify' ? 'Verify existing workspace' : ''), 'task').trim();
  const file = text(raw.file ?? 'incident.txt', 'file', 250);
  const expected = text(raw.expected ?? 'status=fixed', 'expected');
  const command = text(raw.command ?? (DEMO_MODES.includes(mode) ? 'node_test' : 'none'), 'command');
  if (!Object.hasOwn(COMMANDS, command)) throw new Error('Command is not approved');
  fileParts(file);
  return { mode, task, file, expected, command };
}

// Use one bounded read for both the fingerprint and the content comparison.
export async function inspectFile(workspace, file, expected) {
  const parts = fileParts(file);
  let target = await fs.realpath(workspace);
  let handle;
  try {
    let entry;
    for (const part of parts) {
      target = path.join(target, part);
      entry = await fs.lstat(target);
      if (entry.isSymbolicLink()) throw new Error('Symlink escaped or is blocked by workspace policy');
    }
    if (!entry.isFile()) return { snapshot: { exists: false }, detail: 'Target is not a regular file' };
    handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Target must be a regular file without hard links');
    if (stat.size > MAX_FILE_BYTES) throw new Error('Target exceeds the 2 MB evidence limit');
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const final = await handle.stat();
    if (length !== stat.size || stat.mtimeMs !== final.mtimeMs || stat.ctimeMs !== final.ctimeMs) {
      throw new Error('Target changed while evidence was being read');
    }
    const data = buffer.subarray(0, length);
    return {
      snapshot: { exists: true, sha256: createHash('sha256').update(data).digest('hex'), bytes: length },
      matched: expected !== undefined && data.includes(Buffer.from(expected))
    };
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return { snapshot: { exists: false }, detail: 'Target file missing' };
    throw err;
  } finally {
    await handle?.close();
  }
}

export async function snapshotFile(workspace, file) {
  return (await inspectFile(workspace, file)).snapshot;
}

function fileChecks(evidence, file) {
  return [
    { label: 'Target file exists', passed: evidence.snapshot.exists === true, detail: evidence.detail ?? redact(file) },
    { label: 'Required text found in file', passed: evidence.matched === true,
      detail: evidence.detail ?? (evidence.matched ? 'Exact text found' : 'Required text missing') }
  ];
}

export async function verifyFile({ workspace, file, expected }) {
  return fileChecks(await inspectFile(workspace, file, expected), file);
}

export function spawnBounded(executable, args, { cwd, timeoutMs = 30000, stdin, env = process.env, outputLimit = 500_000 } = {}) {
  return new Promise(resolve => {
    const group = process.platform !== 'win32';
    const child = spawn(executable, args, { cwd, shell: false, detached: group, stdio: ['pipe', 'pipe', 'pipe'], env });
    const stdout = [], stderr = [];
    let stdoutBytes = 0, stderrBytes = 0, failure, stopReason, terminationTimer, finished = false;
    const signal = (name) => {
      try {
        if (group && child.pid) process.kill(-child.pid, name);
        else child.kill(name);
      } catch (err) {
        if (err.code !== 'ESRCH') child.kill(name);
      }
    };
    function finish(code) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(terminationTimer);
      resolve({
        exitCode: code ?? -1, stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'), spawnError: failure,
        timedOut: stopReason === 'timeout', outputExceeded: stopReason === 'output'
      });
    }
    function stop(reason) {
      if (stopReason) return;
      stopReason = reason;
      signal('SIGTERM');
      terminationTimer = setTimeout(() => {
        signal('SIGKILL');
        child.stdout.destroy();
        child.stderr.destroy();
        finish(null);
      }, 1500);
    }
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= outputLimit) stdout.push(chunk);
      else stop('output');
    });
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes <= 100_000) stderr.push(chunk);
      else stop('output');
    });
    child.on('error', err => { failure = err.code ?? err.message; });
    child.on('close', code => {
      if (stopReason) signal('SIGKILL');
      finish(code);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

export async function verifyCommand(workspace, command) {
  if (command === 'none') return [];
  if (!Object.hasOwn(COMMANDS, command)) throw new Error('Unsupported verification command');
  const { cmd, args } = COMMANDS[command];
  const env = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'ComSpec', 'TMPDIR', 'TEMP', 'TMP', 'LANG']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const result = await spawnBounded(cmd === 'node' ? process.execPath : cmd, args, { cwd: workspace, env });
  const detail = result.timedOut ? 'Command timed out' :
    result.outputExceeded ? 'Command exceeded the output limit' :
    result.spawnError ? `Could not start command (${result.spawnError})` :
    redact((result.stdout + '\n' + result.stderr).trim()).slice(0, 4200) || `Exit ${result.exitCode}`;
  return [{
    label: `Independent command: ${cmd} ${args.join(' ')}`,
    passed: result.exitCode === 0 && !result.timedOut && !result.outputExceeded && !result.spawnError,
    detail, exitCode: result.exitCode, timedOut: result.timedOut
  }];
}

export async function verifyAcceptance(workspace, spec) {
  const capture = async () => {
    if (await fs.realpath(workspace) !== workspaceRoot) throw new Error('Workspace path changed during the run');
    return inspectFile(workspace, spec.file, spec.expected);
  };
  const workspaceRoot = spec.workspaceRoot ?? await fs.realpath(workspace);
  let evidence;
  let results;
  try {
    evidence = await capture();
    results = fileChecks(evidence, spec.file);
    results.push(...await verifyCommand(workspace, spec.command));
    if (spec.command !== 'none') {
      const afterCommand = await capture();
      if (changedFile(evidence.snapshot, afterCommand.snapshot)) {
        evidence = afterCommand;
        results.push({ label: 'Verification left target unchanged', passed: false, detail: 'The target changed during verification' });
      }
    }
  } catch (err) {
    evidence = { snapshot: { exists: null } };
    results = [{ label: 'Read workspace evidence safely', passed: false, detail: redact(err.message) }];
  }
  return {
    results, snapshot: evidence.snapshot, passed: results.every(check => check.passed),
    count: results.filter(check => check.passed).length, total: results.length
  };
}

export function changedFile(before, after) {
  if (before.exists === null || after.exists === null) return null;
  return before.sha256 !== after.sha256 || before.exists !== after.exists;
}

export function gradeRun(agent, acceptance) {
  if (!agent.ok) return 'agent_failed';
  return acceptance.passed ? 'verified' : 'unverified';
}
