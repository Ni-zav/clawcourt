import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function runDemo(spec, workspace) {
  // Deliberately restricted to the packaged example. Never rewrite user workspaces.
  if (process.env.CLAWCOURT_WORKSPACE) throw new Error('Demo mutation is disabled for custom workspaces');
  if (spec.file !== 'incident.txt' || spec.expected !== 'status=fixed') {
    throw new Error('For the mock scenario, use incident.txt and status=fixed');
  }
  await writeFile(path.join(workspace, 'incident.txt'),
    `INCIDENT #042\nstatus=${spec.mode === 'demo-pass' ? 'fixed':'broken'}\ncause=Unverified completion reports\n`);
  return {
    ok:true, mode:spec.mode, simulated:true, model:'Simulated agent (NO AI)',provider:'offline-demo',durationMs:180,
    answer: spec.mode === 'demo-pass'
      ? 'Claim: Resolved incident #042. The file was updated. Independent tests should confirm the change.'
      : 'Claim: Resolved incident #042 and all tests pass. No changes were actually made. (Intentionally unreliable simulation.)',
    usage:null,error:null
  };
}
