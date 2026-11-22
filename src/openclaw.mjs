import { spawnBounded, redact } from './core.mjs';

function safeText(value) {
  return typeof value === 'string' ? redact(value) : null;
}

export function parseOpenclaw(stdout, exitCode) {
  let data;
  try { data = JSON.parse(stdout); }
  catch { throw new Error('OpenClaw did not return JSON. Check that your CLI supports agent exec --json.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid OpenClaw result envelope');

  const result = data.result ?? data;
  const payloads = Array.isArray(result.payloads) ? result.payloads : [];
  const meta = result.meta ?? data.meta;
  const agent = meta?.agentMeta;
  const reportedError = data.error ?? result.error ?? meta?.error ?? payloads.find(payload => payload?.isError);
  const completed = data.ok === true || data.status === 'ok' || Array.isArray(result.payloads);
  const failed = data.ok === false || result.ok === false || [data.status, result.status].some(status =>
    ['error', 'timeout', 'aborted', 'cancelled', 'canceled', 'failed'].includes(status));
  const ok = exitCode === 0 && completed && !failed && !reportedError && !meta?.aborted &&
    !['error', 'aborted'].includes(meta?.stopReason);
  const rawUsage = data.usage ?? result.usage ?? agent?.usage;
  const usage = Object.fromEntries(['input', 'output', 'total', 'cacheRead', 'cacheWrite'].flatMap(key =>
    Number.isFinite(rawUsage?.[key]) && rawUsage[key] >= 0 ? [[key, rawUsage[key]]] : []));
  return {
    ok,
    answer: safeText(data.final ?? result.final ?? payloads.map(payload => payload?.text)
      .filter(value => typeof value === 'string').join('\n')) ?? '',
    usage: Object.keys(usage).length ? usage : null,
    model: safeText(data.model ?? result.model ?? agent?.model),
    provider: safeText(data.provider ?? result.provider ?? agent?.provider),
    error: safeText(reportedError?.message ?? reportedError?.text ?? reportedError)
  };
}

export async function runOpenclaw(spec, workspace, env = process.env) {
  const message = [
    'Complete the following task in the current workspace.',
    spec.task,
    `Acceptance criterion: ${JSON.stringify(spec.file)} must contain the exact text ${JSON.stringify(spec.expected)}.`,
    'Describe changes and any remaining blockers. Leave acceptance checks intact.'
  ].join('\n\n');
  const args = ['agent', 'exec', '--message-file', '-', '--cwd', workspace, '--json', '--timeout', '180'];
  if (env.CLAWCOURT_OPENCLAW_CONFIG) args.push('--config', env.CLAWCOURT_OPENCLAW_CONFIG);
  const model = env.CLAWCOURT_MODEL?.trim();
  const fallbacks = (env.CLAWCOURT_FALLBACKS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (fallbacks.length && !model) throw new Error('CLAWCOURT_FALLBACKS requires CLAWCOURT_MODEL');
  if (model) args.push('--model', model);
  for (const fallback of fallbacks) args.push('--fallback', fallback);

  const started = performance.now();
  const result = await spawnBounded(env.CLAWCOURT_OPENCLAW_BIN || 'openclaw', args, {
    cwd: workspace, stdin: message, timeoutMs: 200000, env
  });
  let parsed = { ok: false, answer: '', usage: null, model: null, provider: null, error: null };
  let error;
  if (result.spawnError === 'ENOENT') {
    error = 'OpenClaw CLI not found. Install a CLI with agent exec or set CLAWCOURT_OPENCLAW_BIN.';
  } else if (result.spawnError) {
    error = `Could not start OpenClaw (${result.spawnError})`;
  } else if (result.timedOut) {
    error = 'OpenClaw exceeded the 200-second local run limit';
  } else if (result.outputExceeded) {
    error = 'OpenClaw exceeded the CLI output limit';
  } else {
    try { parsed = parseOpenclaw(result.stdout, result.exitCode); }
    catch (err) { error = err.message; }
  }
  if (!parsed.ok && !parsed.error) {
    const diagnostic = redact(result.stderr.trim()).slice(0, 1000);
    parsed.error = [error ?? `OpenClaw did not complete successfully (exit ${result.exitCode})`, diagnostic]
      .filter(Boolean).join('\n');
  }
  return {
    ...parsed,
    simulated: false,
    started: !result.spawnError,
    exitCode: result.exitCode,
    durationMs: result.spawnError ? null : Math.round(performance.now() - started)
  };
}
