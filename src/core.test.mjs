import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link, truncate } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {normalizeRequest,verifyFile,verifyAcceptance,snapshotFile,gradeRun,redact,spawnBounded} from './core.mjs';
import { parseOpenclaw } from './openclaw.mjs';

const valid={mode:'demo-fail',task:'fix the incident',file:'incident.txt',expected:'status=fixed',command:'none'};
test('accepts intended inputs',()=>assert.equal(normalizeRequest(valid).file,'incident.txt'));
test('prevents path traversal and command injection',()=>{
  for(const file of ['../../etc/passwd','/etc/passwd','.env','foo/../bar']) assert.throws(()=>normalizeRequest({...valid,file}));
  assert.throws(()=>normalizeRequest({...valid,command:'sh -c rm -rf /'}));
});
test('reads and verifies actual file rather than agent claims',async()=>{
  const tmp=await mkdtemp(path.join(os.tmpdir(),'clawcourt-test-'));
  try {await writeFile(path.join(tmp,'incident.txt'),'status=broken');
    const v=await verifyAcceptance(tmp,valid);
    assert.equal(v.passed,false); assert.equal(v.count,1);
    await writeFile(path.join(tmp,'incident.txt'),'status=fixed');
    assert.equal((await verifyAcceptance(tmp,valid)).passed,true);
  }finally{await rm(tmp,{recursive:true,force:true});}
});
test('prevents symlink reading outside workspace',async()=>{
  const tmp=await mkdtemp(path.join(os.tmpdir(),'clawcourt-link-'));
  try {await symlink('/etc/hosts',path.join(tmp,'incident.txt')); await assert.rejects(()=>verifyFile({workspace:tmp,file:'incident.txt',expected:'localhost'}),/Symlink escaped/);}
  finally{await rm(tmp,{recursive:true,force:true});}
});
test('parses documented OpenClaw exec envelope and flags errors',()=>{
  const x=parseOpenclaw(JSON.stringify({ok:true,status:'ok',final:'Task done',model:'x',provider:'y'}),0);
  assert.equal(x.ok,true);assert.equal(x.answer,'Task done');
  assert.equal(parseOpenclaw(JSON.stringify({ok:false,error:{message:'Bad auth'}}),1).ok,false);
});
test('judge verdict requires actual independent evidence',()=>{
  assert.equal(gradeRun({ok:true},{passed:false}),'unverified');
  assert.equal(gradeRun({ok:false},{passed:true}),'agent_failed');
  assert.equal(gradeRun({ok:true},{passed:true}),'verified');
});
test('redacts obvious secrets from logs',()=>assert.ok(!redact('api_key=SECRETKEYLONG').includes('SECRETKEYLONG')));

test('snapshots independently show whether file contents changed',async()=>{
  const tmp=await mkdtemp(path.join(os.tmpdir(),'clawcourt-snapshot-'));
  try {await writeFile(path.join(tmp,'x.txt'),'a'); const first=await snapshotFile(tmp,'x.txt'); await writeFile(path.join(tmp,'x.txt'),'b'); const second=await snapshotFile(tmp,'x.txt'); assert.notEqual(first.sha256,second.sha256); assert.equal(first.bytes,1);}
  finally {await rm(tmp,{recursive:true,force:true});}
});

test('approval uses own command keys and evidence preserves literal spaces', () => {
  for (const command of ['constructor', '__proto__', 'toString']) {
    assert.throws(() => normalizeRequest({ ...valid, command }), /not approved/);
  }
  assert.equal(normalizeRequest({ ...valid, expected: ' exact ' }).expected, ' exact ');
  assert.throws(() => normalizeRequest({ ...valid, file: 'nested/.env' }), /hidden/);
});

test('rejects internal directory symlinks, hard links, and oversized evidence', async t => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'clawcourt-evidence-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  await mkdir(path.join(tmp, 'dir'));
  await writeFile(path.join(tmp, 'dir/file'), 'hello');
  await symlink(path.join(tmp, 'dir'), path.join(tmp, 'alias'), 'dir');
  await assert.rejects(snapshotFile(tmp, 'alias/file'), /Symlink/);
  await link(path.join(tmp, 'dir/file'), path.join(tmp, 'hard'));
  await assert.rejects(snapshotFile(tmp, 'hard'), /hard links/);
  await writeFile(path.join(tmp, 'large'), '');
  await truncate(path.join(tmp, 'large'), 2_000_001);
  await assert.rejects(snapshotFile(tmp, 'large'), /2 MB/);
});

test('command timeout and output limit fail closed', async () => {
  const hanging = await spawnBounded(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 100 });
  assert.equal(hanging.timedOut, true);
  const noisy = await spawnBounded(process.execPath, ['-e', 'console.log("a".repeat(10000))'], { outputLimit: 100 });
  assert.equal(noisy.outputExceeded, true);
});

test('target rewritten by verification is unverified', async t => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'clawcourt-changing-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  await writeFile(path.join(tmp, 'incident.txt'), 'status=fixed');
  await writeFile(path.join(tmp, 'rewrite.test.mjs'),
    'import { writeFileSync } from "node:fs"; writeFileSync("incident.txt", "status=broken");');
  const evidence = await verifyAcceptance(tmp, { ...valid, command: 'node_test' });
  assert.equal(evidence.passed, false);
  assert.match(evidence.results.at(-1).detail, /changed during verification/);
});

test('redacts authorization headers and quoted secrets', () => {
  assert.equal(redact('Authorization: Bearer abc.def'), 'Authorization: [REDACTED]');
  assert.equal(redact('{"password":"two words"}'), '{"password":[REDACTED]}');
});

test('OpenClaw rejects unknown success envelopes and recognizes nested result errors', () => {
  assert.equal(parseOpenclaw('{}', 0).ok, false);
  assert.throws(() => parseOpenclaw('null', 0), /envelope/);
  assert.equal(parseOpenclaw('{"result":{"payloads":[{"isError":true,"text":"No auth"}]}}', 0).ok, false);
  assert.equal(parseOpenclaw('{"result":{"payloads":[{"text":"done"}],"meta":{"agentMeta":{"model":"x","provider":"y"}}}}', 0).provider, 'y');
});


test('parses recorded envelopes from OpenClaw 2026.11.6', async () => {
  const fixture = name => readFile(new URL(`../fixtures/openclaw/${name}.json`, import.meta.url), 'utf8');
  const success = parseOpenclaw(await fixture('success'), 0);
  assert.equal(success.ok, true);
  assert.equal(success.model, 'qwen3:0.6b');
  assert.equal(success.provider, 'ollama');
  assert.match(success.answer, /^CLAWCOURT_OK/);
  assert.ok(success.usage.output > 0);
  const failed = parseOpenclaw(await fixture('unknown-model'), 1);
  assert.equal(failed.ok, false);
  assert.equal(failed.provider, null);
  assert.match(failed.error, /Unknown model/);
});
