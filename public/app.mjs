const element = id => document.getElementById(id);
const modeButtons = [...document.querySelectorAll('[data-mode]')];
const initialTask = element('task').value;
const defaultFile = element('file').value;
const defaultExpected = element('expected').value;
const actionLabels = { verify: 'Verify workspace', openclaw: 'Run OpenClaw and verify' };
const verdicts = {
  verified: ['Verified', 'All configured acceptance checks passed.'],
  unverified: ['Unverified', 'One or more acceptance checks failed.'],
  agent_failed: ['Agent failed', 'The agent did not complete successfully. Check the execution details below.']
};
const origins = {
  simulation: 'SIMULATED · NO AI',
  verification_only: 'VERIFICATION ONLY',
  openclaw_cli: 'OPENCLAW CLI',
  openclaw_unavailable: 'OPENCLAW UNAVAILABLE',
  historical: 'HISTORICAL RECEIPT'
};
let mode = 'demo-fail';
let selectedRun;
let runs = [];
let health;
let inFlight = false;
let toastTimer;
let draft = { task: initialTask, file: defaultFile, expected: defaultExpected, command: 'none' };

function make(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function toast(message) {
  clearTimeout(toastTimer);
  const target = element('toast');
  target.hidden = false;
  target.textContent = message;
  toastTimer = setTimeout(() => { target.hidden = true; }, 4300);
}

function provenance(run) {
  // Legacy or inconsistent simulated records always keep the simulation label.
  return run.agent.simulated || run.spec.mode?.startsWith('demo-') ? origins.simulation :
    (origins[run.provenance] ?? origins.historical);
}

function showReceipt(run, focus = false) {
  selectedRun = run;
  const [label, detail] = verdicts[run.verdict] ?? ['Unknown', 'Verdict unavailable'];
  const verdict = element('verdict');
  verdict.className = run.verdict;
  verdict.textContent = label;
  element('verdict-detail').textContent = detail;
  element('kind').textContent = provenance(run);
  element('evidence-title').textContent = `Acceptance checks · ${run.acceptance.count}/${run.acceptance.total}`;
  element('checks').replaceChildren(...run.acceptance.results.map(check => {
    const row = make('div', undefined, 'check');
    const mark = make('div', check.passed ? '✓' : '×', check.passed ? 'checkmark' : 'checkmark fail');
    mark.setAttribute('aria-hidden', 'true');
    const explanation = make('div');
    explanation.append(make('strong', `${check.passed ? 'Pass' : 'Fail'} · ${check.label}`), make('small', check.detail));
    row.append(mark, explanation);
    return row;
  }));
  element('receipt-evidence').hidden = false;
  const verifyOnly = run.provenance === 'verification_only';
  const simulated = provenance(run) === origins.simulation;
  const { provider, model, durationMs, answer, error } = run.agent;
  element('agent-heading').textContent = verifyOnly ? 'WORKSPACE CHECK' : 'AGENT STATEMENT';
  element('agent-text').textContent = verifyOnly ? 'Checked the existing workspace.' : answer || 'No agent message captured.';
  element('agent-error').hidden = !error;
  element('agent-error').textContent = error ?? '';
  element('agent-meta').textContent = !simulated && !verifyOnly ? [
    provider && `Provider ${provider}`,
    model && `Model ${model}`,
    durationMs != null && `CLI wall time ${durationMs} ms`
  ].filter(Boolean).join(' · ') : '';

  const evidence = run.evidenceChange;
  const change = evidence?.changed;
  element('change-summary').textContent = change === true ? 'Target changed · view fingerprints' :
    change === false ? 'Target unchanged · view fingerprints' : 'File fingerprints';
  const fields = ['before', 'after'].flatMap(phase => {
    const fingerprint = evidence?.[phase];
    return [make('dt', phase === 'before' ? 'Before · SHA-256' : 'After · SHA-256'),
      make('dd', fingerprint?.sha256 ?? (fingerprint?.exists === false ? 'File missing' : 'Unavailable'))];
  });
  element('hashes').replaceChildren(...fields);
  element('download').disabled = false;
  element('copy').disabled = false;
  if (focus) verdict.focus();
}

function renderHistory() {
  const pass = runs.filter(run => run.verdict === 'verified').length;
  element('stat-total').textContent = runs.length;
  element('stat-pass').textContent = pass;
  element('stat-fail').textContent = runs.length - pass;
  const table = element('history');
  if (!runs.length) return;
  table.replaceChildren(...runs.map(run => {
    const row = make('tr');
    const button = make('button', '#' + run.id.slice(0, 8), 'history-link');
    button.type = 'button';
    button.setAttribute('aria-label', `Open case ${run.id.slice(0, 8)}`);
    button.addEventListener('click', () => showReceipt(run, true));
    const caseCell = make('td');
    caseCell.append(button);
    row.append(caseCell, make('td', provenance(run)),
      make('td', verdicts[run.verdict]?.[0] ?? 'Unknown', 'tiny-verdict ' + run.verdict),
      make('td', `${run.acceptance.count}/${run.acceptance.total}`),
      make('td', new Date(run.started).toLocaleString()));
    return row;
  }));
}

const inputs = ['task', 'file', 'expected', 'command'];
const isDemo = value => value.startsWith('demo-');
function switchMode(next) {
  if (!isDemo(mode)) draft = Object.fromEntries(inputs.map(id => [id, element(id).value]));
  mode = next;
  const demo = isDemo(mode);
  const canExecuteCommand = mode === 'openclaw' ? health.liveCommandsEnabled : health.commandsEnabled;
  const values = demo ? { task: initialTask, file: defaultFile, expected: defaultExpected, command: 'node_test' } : draft;
  for (const id of inputs) {
    element(id).value = id === 'command' && !canExecuteCommand ? 'none' : values[id];
    element(id).disabled = demo || (id === 'command' && !canExecuteCommand);
  }
  element('task-label').textContent = mode === 'verify' ? 'Receipt description' : 'Agent task';
  for (const button of modeButtons) {
    const selected = button.dataset.mode === mode;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected);
  }
  let notice = 'Simulation with real file and test checks. No model is called.';
  if (!demo) {
    notice = mode === 'verify' ? 'Check the current files without running an agent.' :
      'OpenClaw can modify this workspace using its configured tool policy.';
    if (!canExecuteCommand) notice += ' Workspace commands are disabled.';
  }
  element('notice').textContent = notice;
  element('run').textContent = actionLabels[mode] ?? 'Run simulation';
}

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

for (const button of modeButtons) {
  button.addEventListener('click', () => { if (health && !inFlight) switchMode(button.dataset.mode); });
}

element('trial').addEventListener('submit', async event => {
  event.preventDefault();
  if (!health || inFlight) return;
  inFlight = true;
  const data = { mode, ...Object.fromEntries(inputs.map(id => [id, element(id).value])) };
  const activeControls = [...event.currentTarget.elements].filter(input => !input.disabled);
  for (const input of activeControls) input.disabled = true;
  const status = element('run-status');
  status.textContent = mode === 'openclaw' ? 'Running OpenClaw and checking evidence…' : 'Checking evidence…';
  try {
    const { run } = await request('/api/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    runs = [run, ...runs].slice(0, 100);
    renderHistory();
    status.textContent = `${verdicts[run.verdict][0]} · ${run.acceptance.count}/${run.acceptance.total} checks passed.`;
    showReceipt(run, true);
  } catch (err) {
    status.textContent = `Could not run trial. ${err.message}`;
  } finally {
    inFlight = false;
    for (const input of activeControls) input.disabled = false;
  }
});

element('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(selectedRun, null, 2)], { type: 'application/json' }));
  const link = make('a');
  link.href = url;
  link.download = `clawcourt-${selectedRun.id.slice(0, 8)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
});

element('copy').addEventListener('click', async () => {
  const run = selectedRun;
  const summary = [
    `ClawCourt #${run.id.slice(0, 8)} · ${provenance(run)}`,
    `${verdicts[run.verdict]?.[0]} · ${run.acceptance.count}/${run.acceptance.total} checks passed`,
    ...run.acceptance.results.map(check => `${check.passed ? 'PASS' : 'FAIL'} · ${check.label}`)
  ].join('\n');
  try {
    await navigator.clipboard.writeText(summary);
    toast('Receipt summary copied');
  } catch {
    toast('Clipboard unavailable. You can export the JSON receipt.');
  }
});

try {
  const [status, history] = await Promise.all([request('/api/health'), request('/api/runs')]);
  health = status;
  element('stat-workspace').textContent = health.workspace;
  if (!health.openclawEnabled) {
    element('mode-help').textContent = 'To enable OpenClaw, restart with CLAWCOURT_ENABLE_OPENCLAW=1.';
  }
  for (const button of modeButtons) {
    button.disabled = isDemo(button.dataset.mode) ? !health.demoEnabled :
      button.dataset.mode === 'openclaw' && !health.openclawEnabled;
  }
  switchMode(health.demoEnabled ? 'demo-fail' : 'verify');
  element('run').disabled = false;
  runs = history.runs;
  renderHistory();
  if (runs.length) showReceipt(runs[0]);
} catch (err) {
  element('run-status').textContent = `Could not load ClawCourt. ${err.message}`;
}
