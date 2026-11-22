import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnBounded, parseOpenclaw, redact } from './core.mjs';

/** Uses the documented OpenClaw headless agent harness, not direct model HTTP. */
export async function runOpenclaw(spec, workspace) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'clawcourt-'));
  const message = `TASK: ${spec.task}\n\nWork only inside ${workspace}. You may inspect files and make necessary changes for the task.\nAcceptance criterion: file ${spec.file} must contain exact text ${JSON.stringify(spec.expected)}.\nDo not claim tests passed unless they were run. Describe what you changed and any remaining blockers.`;
  const promptPath = path.join(tmp, 'task.md');
  try {
    await writeFile(promptPath, message, {mode:0o600});
    const args = ['agent','exec','--message-file',promptPath,'--cwd',workspace,'--json','--timeout','180'];
    const model = process.env.CLAWCOURT_MODEL?.trim();
    if (model) {
      args.push('--model',model);
      const fallbacks = (process.env.CLAWCOURT_FALLBACKS ?? '').split(',').map(x=>x.trim()).filter(Boolean);
      for (const fallback of fallbacks) args.push('--fallback',fallback);
    }
    const started = performance.now();
    const result = await spawnBounded(process.env.CLAWCOURT_OPENCLAW_BIN || 'openclaw',args,{cwd:workspace,timeoutMs:200000});
    let parsed;
    try { parsed = parseOpenclaw(result.stdout, result.exitCode); }
    catch(err) { parsed={ok:false,answer:'',usage:null,provider:null,model:null,error: result.stderr?.includes('ENOENT') ? 'OpenClaw CLI not found. Install OpenClaw and configure an agent first.' : err.message}; }
    if(result.timedOut) parsed = {...parsed,ok:false,error:'OpenClaw CLI exceeded the 200-second local timeout'};
    if(result.exitCode !== 0 && !parsed.error) parsed.error = `OpenClaw exited with code ${result.exitCode}: ${redact(result.stderr).slice(-2000)}`;
    return {...parsed, mode:'openclaw', durationMs:Math.round(performance.now()-started), simulated:false};
  } finally { await rm(tmp,{recursive:true,force:true}); }
}
