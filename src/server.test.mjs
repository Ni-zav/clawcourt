import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createClawCourt } from './server.mjs';

const spec = { task: 'Fix the incident', file: 'incident.txt', expected: 'status=fixed', command: 'node_test' };

async function launch(t, env = {}, temp = awaitTemp()) {
  const home = await temp;
  t.after(() => rm(home, { recursive: true, force: true }));
  const server = createClawCourt({ env, dataDir: path.join(home, 'data') });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (mode, overrides = {}, headers = {}) => fetch(url + '/api/runs', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ ...spec, mode, ...overrides })
  });
  return { url, post };
}

function awaitTemp() {
  return mkdtemp(path.join(os.tmpdir(), 'clawcourt-http-'));
}

test('HTTP demo receipts are repeatable and distinctly simulated', async t => {
  const { url, post } = await launch(t);
  const original = await readFile(new URL('../fixtures/playground/incident.txt', import.meta.url), 'utf8');
  const scenarios = [
    ['demo-fail', 'unverified', 1, false],
    ['demo-pass', 'verified', 3, true],
    ['demo-agent-failed', 'agent_failed', 3, false],
    ['demo-fail', 'unverified', 1, false]
  ];
  for (const [mode, verdict, checks, changed] of scenarios) {
    const res = await post(mode);
    assert.equal(res.status, 201);
    const { run } = await res.json();
    assert.equal(run.provenance, 'simulation');
    assert.equal(run.verdict, verdict);
    assert.equal(run.acceptance.count, checks);
    assert.equal(run.evidenceChange.changed, changed);
    assert.equal(run.agent.durationMs, null);
    assert.equal(run.agent.usage, null);
    assert.deepEqual(await fetch(url + '/api/runs/' + run.id).then(r => r.json()), run);
  }
  assert.equal((await fetch(url + '/api/runs').then(r => r.json())).runs.length, 4);
  assert.equal(await readFile(new URL('../fixtures/playground/incident.txt', import.meta.url), 'utf8'), original);
});

test('missing OpenClaw creates an unavailable receipt despite passing evidence', async t => {
  const { post } = await launch(t, {
    CLAWCOURT_ENABLE_OPENCLAW: '1',
    CLAWCOURT_OPENCLAW_BIN: path.join(os.tmpdir(), 'missing-clawcourt-openclaw-cli')
  });
  const res = await post('openclaw', { expected: 'status=broken', command: 'none' });
  assert.equal(res.status, 201);
  const { run } = await res.json();
  assert.equal(run.provenance, 'openclaw_unavailable');
  assert.equal(run.verdict, 'agent_failed');
  assert.equal(run.acceptance.passed, true);
  assert.match(run.agent.error, /CLI not found/);
});

test('HTTP enforces loopback authority, same origin, JSON, and opt-in execution', async t => {
  const { url, post } = await launch(t);
  assert.equal((await post('demo-pass', {}, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await post('demo-pass', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => {
    http.get(url + '/api/runs', { headers: { Host: 'other.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await post('demo-pass', {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('demo-pass', { task: 'x'.repeat(40001) })).status, 400);
  assert.equal((await post('openclaw')).status, 403);
  const index = await fetch(url);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(url + '/app.mjs')).status, 200);
});

test('custom workspace supports verification only and rejects commands by default', async t => {
  const temp = await awaitTemp();
  await writeFile(path.join(temp, 'incident.txt'), 'status=fixed');
  const { post } = await launch(t, { CLAWCOURT_WORKSPACE: temp }, temp);
  assert.equal((await post('demo-pass')).status, 403);
  assert.equal((await post('verify')).status, 403);
  const response = await post('verify', { command: 'none' });
  assert.equal(response.status, 201);
  const { run } = await response.json();
  assert.equal(run.provenance, 'verification_only');
  assert.equal(run.verdict, 'verified');
  assert.equal(run.evidenceChange.changed, false);
});

test('concurrent HTTP requests admit only one run', async t => {
  const temp = await awaitTemp();
  await writeFile(path.join(temp, 'incident.txt'), 'status=fixed');
  await writeFile(path.join(temp, 'wait.test.mjs'), 'await new Promise(resolve => setTimeout(resolve, 300));');
  const { post } = await launch(t, {
    CLAWCOURT_WORKSPACE: temp, CLAWCOURT_ALLOW_WORKSPACE_COMMANDS: '1'
  }, temp);
  const statuses = (await Promise.all([post('verify'), post('verify')])).map(res => res.status).sort();
  assert.deepEqual(statuses, [201, 409]);
});
