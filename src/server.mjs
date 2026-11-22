import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DEMO_MODES, normalizeRequest, verifyAcceptance, gradeRun, redact, snapshotFile, changedFile } from './core.mjs';
import { runOpenclaw } from './openclaw.mjs';
import { DEMO_TASK, fixedIncident, runDemo } from './mock.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = path.join(root, 'fixtures/playground');
const assets = {
  '/': ['index.html', 'text/html'],
  '/app.mjs': ['app.mjs', 'text/javascript'],
  '/styles.css': ['styles.css', 'text/css']
};
const maxRuns = 100;
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

function send(res, status, data, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type + '; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
}

async function readSpec(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length <= 40_000) chunks.push(chunk);
  }
  if (length > 40_000) throw new Error('Request body exceeds 40 KB');
  return normalizeRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

function localOrigin(req, port) {
  const host = req.headers.host;
  const authority = port === 80 ? [...loopbackHosts] : [];
  for (const address of loopbackHosts) authority.push(`${address}:${port}`);
  if (!authority.includes(host)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  return req.headers.origin === undefined || req.headers.origin === `http://${host}`;
}

async function collectRun(spec, workspace, env) {
  const id = randomUUID();
  const started = new Date().toISOString();
  const demo = DEMO_MODES.includes(spec.mode);
  const verifyOnly = spec.mode === 'verify';
  const workspaceRoot = await fs.realpath(workspace);
  const before = await snapshotFile(workspaceRoot, spec.file);
  let agent;
  try {
    agent = demo ? await runDemo(spec, workspaceRoot) :
      verifyOnly ? { ok: true, simulated: false } : await runOpenclaw(spec, workspaceRoot, env);
  } catch (err) {
    agent = { ok: false, simulated: demo, error: redact(err.message) };
  }
  const provenance = demo ? 'simulation' : verifyOnly ? 'verification_only' :
    agent.started ? 'openclaw_cli' : 'openclaw_unavailable';
  const { snapshot: after, ...acceptance } = await verifyAcceptance(workspaceRoot, { ...spec, workspaceRoot });
  return {
    schemaVersion: 2, id, started, provenance,
    spec: { ...spec, task: redact(spec.task), file: redact(spec.file), expected: redact(spec.expected) },
    agent, acceptance, evidenceChange: { before, after, changed: changedFile(before, after) },
    verdict: gradeRun(agent, acceptance)
  };
}

export function createClawCourt({ env = process.env, dataDir = path.join(root, '.data') } = {}) {
  const customWorkspace = env.CLAWCOURT_WORKSPACE;
  if (customWorkspace && !path.isAbsolute(customWorkspace)) throw new Error('CLAWCOURT_WORKSPACE must be an absolute path');
  if (env.CLAWCOURT_OPENCLAW_CONFIG && !path.isAbsolute(env.CLAWCOURT_OPENCLAW_CONFIG)) {
    throw new Error('CLAWCOURT_OPENCLAW_CONFIG must be an absolute path');
  }
  const openclawEnabled = env.CLAWCOURT_ENABLE_OPENCLAW === '1';
  const liveCommandsEnabled = env.CLAWCOURT_ALLOW_WORKSPACE_COMMANDS === '1';
  const commandsEnabled = !customWorkspace || liveCommandsEnabled;
  const dataFile = path.join(dataDir, 'runs.json');
  let busy = false;

  async function loadRuns() {
    try {
      const runs = JSON.parse(await fs.readFile(dataFile, 'utf8'));
      return runs.map(run => run.provenance ? run :
        { ...run, provenance: run.agent?.simulated ? 'simulation' : 'historical' });
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async function saveRun(run) {
    const runs = [run, ...await loadRuns()].slice(0, maxRuns);
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const temp = path.join(dataDir, `.runs-${run.id}.tmp`);
    try {
      await fs.writeFile(temp, JSON.stringify(runs, null, 2), { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, dataFile);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }

  const server = http.createServer({ requestTimeout: 15_000, headersTimeout: 10_000, connectionsCheckingInterval: 1000 }, async (req, res) => {
    if (!localOrigin(req, server.address().port)) return send(res, 403, { error: 'Only same-origin loopback requests are accepted' });
    try {
      const route = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && Object.hasOwn(assets, route)) {
        const [file, type] = assets[route];
        return send(res, 200, await fs.readFile(path.join(root, 'public', file), 'utf8'), type);
      }
      if (req.method === 'GET' && route === '/api/health') {
        return send(res, 200, {
          ok: true, workspace: customWorkspace ? redact(path.basename(customWorkspace)) : 'Disposable incident fixture',
          openclawEnabled, commandsEnabled, liveCommandsEnabled, demoEnabled: !customWorkspace, busy
        });
      }
      if (req.method === 'GET' && route === '/api/runs') return send(res, 200, { runs: await loadRuns() });
      if (req.method === 'GET' && route.startsWith('/api/runs/')) {
        const found = (await loadRuns()).find(run => run.id === route.slice('/api/runs/'.length));
        return send(res, found ? 200 : 404, found ?? { error: 'Run not found' });
      }
      if (req.method !== 'POST' || route !== '/api/runs') return send(res, 404, { error: 'Not found' });
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
        return send(res, 415, { error: 'Use application/json' });
      }
      let spec;
      try { spec = await readSpec(req); }
      catch (err) { return send(res, 400, { error: err instanceof SyntaxError ? 'Invalid JSON request' : redact(err.message) }); }

      const demo = DEMO_MODES.includes(spec.mode);
      if (demo && customWorkspace) return send(res, 403, { error: 'Simulations use the packaged workspace' });
      if (spec.mode === 'openclaw' && !openclawEnabled) {
        return send(res, 403, { error: 'Enable OpenClaw with CLAWCOURT_ENABLE_OPENCLAW=1' });
      }
      if (spec.command !== 'none' && !(spec.mode === 'openclaw' ? liveCommandsEnabled : commandsEnabled)) {
        return send(res, 403, { error: 'Workspace commands require CLAWCOURT_ALLOW_WORKSPACE_COMMANDS=1' });
      }
      if (demo) spec = { mode: spec.mode, task: DEMO_TASK, file: 'incident.txt', expected: 'status=fixed', command: 'node_test' };
      if (busy) return send(res, 409, { error: 'Another run is active. Try again when it finishes.' });
      busy = true;
      let temp, run;
      try {
        if (!customWorkspace) {
          temp = await fs.mkdtemp(path.join(os.tmpdir(), 'clawcourt-workspace-'));
          await fs.cp(fixture, temp, { recursive: true });
          if (spec.mode === 'demo-agent-failed') await fs.writeFile(path.join(temp, 'incident.txt'), fixedIncident);
        }
        run = await collectRun(spec, customWorkspace ?? temp, env);
        await saveRun(run);
      } finally {
        try { if (temp) await fs.rm(temp, { recursive: true, force: true }); }
        catch (err) { console.error('Could not clean up run workspace:', err.code ?? 'unknown'); }
        busy = false;
      }
      return send(res, 201, { run });
    } catch (err) {
      return send(res, 500, { error: redact(err.message) });
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  const host = process.env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('HOST must be a loopback IP literal');
  const server = createClawCourt();
  server.listen(port, host, () => {
    console.log(`ClawCourt on http://${host === '::1' ? '[::1]' : host}:${server.address().port}`);
  });
}
