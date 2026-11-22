import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEMO_TASK = 'Fix incident #042 by changing its status to fixed. Report what changed.';
const answers = {
  'demo-fail': 'Claim: Resolved incident #042 and all tests pass. The simulated agent left the file unchanged.',
  'demo-pass': 'Claim: Resolved incident #042. The simulated agent updated the file.',
  'demo-agent-failed': 'The simulated agent stopped before making any changes.'
};

export const fixedIncident = 'INCIDENT #042\nstatus=fixed\ncause=Unverified completion reports\n';

export async function runDemo(spec, workspace) {
  if (spec.mode === 'demo-pass') {
    await writeFile(path.join(workspace, 'incident.txt'), fixedIncident);
  }
  return {
    ok: spec.mode !== 'demo-agent-failed', simulated: true,
    answer: answers[spec.mode], provider: null, model: null, usage: null, durationMs: null,
    error: spec.mode === 'demo-agent-failed' ? 'Simulated agent failure' : null
  };
}
