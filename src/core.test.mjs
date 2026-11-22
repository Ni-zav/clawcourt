import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {normalizeRequest,verifyFile,verifyAcceptance,snapshotFile,parseOpenclaw,gradeRun,redact} from './core.mjs';

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
