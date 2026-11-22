import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { normalizeRequest, verifyAcceptance, gradeRun, redact, snapshotFile } from './core.mjs';
import { runOpenclaw } from './openclaw.mjs';
import { runDemo } from './mock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workspace = path.resolve(process.env.CLAWCOURT_WORKSPACE || path.join(root,'fixtures/playground'));
const dataDir = path.join(root,'.data');
const dataFile = path.join(dataDir,'runs.json');
const html = path.join(root,'public/index.html');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
let busy = false;

async function loadRuns() { try{return JSON.parse(await fs.readFile(dataFile,'utf8'));}catch(err){if(err.code==='ENOENT')return [];throw err;} }
async function saveRuns(runs) { await fs.mkdir(dataDir,{recursive:true}); const tmp = dataFile+'.tmp';await fs.writeFile(tmp,JSON.stringify(runs.slice(0,100),null,2));await fs.rename(tmp,dataFile); }
function send(res,status,data,contentType='application/json; charset=utf-8') {
  res.writeHead(status,{'Content-Type':contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"});
  res.end(contentType.startsWith('application/json')?JSON.stringify(data):data);
}
async function body(req) {
  const chunks=[];let length=0;
  for await (const chunk of req) { length+=chunk.length;if(length>20000)throw new Error('Request body too large');chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function safeRunView(run) { return run; }
const server=http.createServer(async (req,res)=>{
  try {
    const route=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET' && route==='/') return send(res,200,await fs.readFile(html,'utf8'),'text/html; charset=utf-8');
    if(req.method==='GET' && route==='/api/health') return send(res,200,{ok:true,workspace,openclawConfigured:Boolean(process.env.CLAWCOURT_MODEL),demoEnabled:!process.env.CLAWCOURT_WORKSPACE,busy});
    if(req.method==='GET' && route==='/api/runs') return send(res,200,{runs:(await loadRuns()).map(safeRunView)});
    if(req.method==='GET' && route.startsWith('/api/runs/')) { const id=route.slice('/api/runs/'.length);const found=(await loadRuns()).find(x=>x.id===id);return send(res,found?200:404,found||{error:'Run not found'}); }
    if(req.method==='POST' && route==='/api/runs') {
      if(busy) return send(res,409,{error:'Another run is active. Run tasks serially to protect the workspace.'});
      const spec=normalizeRequest(await body(req));busy=true;
      try {
        const id=randomUUID();const started=new Date().toISOString();
        const before = await snapshotFile(workspace,spec.file);
        let agent;
        try {agent=spec.mode==='openclaw'?await runOpenclaw(spec,workspace):await runDemo(spec,workspace);}
        catch(err){agent={ok:false,answer:'',provider:'',model:'',error:redact(err.message),durationMs:0,simulated:spec.mode!=='openclaw'};}
        const after = await snapshotFile(workspace,spec.file);
        const evidenceChange = {before, after, changed: before.sha256 !== after.sha256 || before.exists !== after.exists};
        const acceptance=await verifyAcceptance(workspace,spec);
        const record={id,started,spec,agent,acceptance,evidenceChange,verdict:gradeRun(agent,acceptance)};
        await saveRuns([record,...await loadRuns()]);
        return send(res,201,{run:record});
      } finally {busy=false;}
    }
    return send(res,404,{error:'Not found'});
  }catch(err){send(res,err instanceof SyntaxError||/Invalid|Unsupported|not approved|traversal|relative|disabled|mock scenario|too large/i.test(err.message)?400:500,{error:redact(err.message)});}
});
if (process.env.NODE_ENV!=='test') server.listen(port,host,()=>console.log(`ClawCourt on http://${host}:${port} | workspace: ${workspace}`));
export {server};
