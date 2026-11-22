# ClawCourt — put AI agent claims on trial

> **The agent said it's done. The evidence gets the final vote.**

ClawCourt runs an OpenClaw task, captures the agent's answer, then performs an **independent acceptance check** against actual workspace files, file SHA-256 before/after fingerprints, and a selected test/build command. It assigns a verdict: **VERIFIED**, **UNVERIFIED**, or **AGENT FAILED**, and preserves a shareable local run receipt. Developed as a provider-agnostic project for the November 2026 Cerebras × Moonshot Kimi × OpenClaw community event.

**Eligibility note:** The event's official prizes require Kimi K3.1 Pro on Cerebras as a central component, plus OpenClaw. The offline simulator and any other model are **not** prize-eligible substitutes. We do not claim Cerebras/Kimi usage or speed measurements.

## Run in 30 seconds — zero API keys

Requirements: Node.js >=20. No `npm install` needed.

```bash
npm start
# open http://127.0.0.1:4173
```

Click **Simulate false claim**, then **Run agent + verify**. The simulated agent claims the incident was fixed, but independent file and `node --test` checks fail. Next choose **Simulate real fix**: the fixture is really changed and tests pass. The UI explicitly flags simulations; no inference occurs.

```bash
npm test
npm run check
```

## Connect a real OpenClaw agent (optional)

1. Install and configure [OpenClaw](https://docs.openclaw.ai/), with any provider or local model OpenClaw supports.
2. Optionally export `CLAWCOURT_MODEL` for the explicit model to use. If omitted, OpenClaw uses your configured default.
3. Optionally set `CLAWCOURT_WORKSPACE=/absolute/path/to/safe/test-repo`. Do **not** point at a sensitive production directory. ClawCourt's demo modes are disabled when a custom workspace is selected.
4. Start ClawCourt, select **Real OpenClaw**, configure the task, relative target file, acceptance phrase, and approved verification command.

It calls the documented headless harness:

```bash
openclaw agent exec --message-file <temporary-task-file> --cwd <workspace> --json --timeout 180
```

The real CLI's `ok` envelope reflects agent execution, **not** acceptance; ClawCourt independently verifies the result. ClawCourt does not call an LLM provider HTTP API directly. Provider keys are configured in OpenClaw, not entered into the ClawCourt UI.

Model fallbacks, where supported, can be supplied via `CLAWCOURT_MODEL` and comma-separated `CLAWCOURT_FALLBACKS`, passed as OpenClaw's own `--model/--fallback` flags. This project does not pretend to improve on OpenClaw's built-in failover.

## Security and honesty

- Loopback only (`127.0.0.1`) by default. No cloud, telemetry, login, or secrets stored.
- Workspace fixed server-side; API clients cannot choose arbitrary roots. Only allowlisted test/build commands; no shell interpolation.
- Paths are relative and symlink escapes are rejected. Demo modifications are restricted to the packaged fixture.
- OpenClaw agents still have whatever access your local OpenClaw execution policy allows. Use disposable workspaces; inspect OpenClaw policy before granting file/shell access.
- A passing acceptance criterion is **not** proof that the requested task is wholly correct. Add stronger tests for high-stakes tasks.
- Raw user-chosen tasks, model responses, and test output are stored **locally** in `.data/runs.json` for the receipts; avoid sensitive inputs and remove the file to clear history.
- The `SIMULATED — NO AI` label is permanent on mock runs. Never represent simulated speed, usage, or provider as measured.

## Audience Choice demo script (noncompetitive without approved model)

0–10s: "Your AI agent says DONE. But did it actually do the work?"
10–22s: Run a simulated false-claim task. Show the claimed success, then the red independent checks.
22–38s: Run a second simulated actual fix. Independent test passes and verdict turns green.
38–52s: Show receipts with test evidence and provider/model labels. OpenClaw integration uses the real `agent exec` CLI when configured.
52–60s: "Trust the evidence, not the sentence. Open source and provider-agnostic." Do not claim competition eligibility unless the required Kimi + Cerebras + OpenClaw demonstration has actually occurred.

## Hackathon links
- [Official hackathon guide](https://docs.google.com/document/d/1Vvf2SjScBt3yBeTVZRoKtOyE7rGEP-gWV_ApzwXepEQ/edit)
- [OpenClaw headless agent CLI](https://docs.openclaw.ai/cli/agent)
- [Cerebras API docs](https://inference-docs.cerebras.ai/api-reference/chat-completions)

## Future development
- Real GitHub PR diff and revision hash receipts
- Signed receipts and machine-readable CI integrations
- Multi-step acceptance plans and policy-gated agent action approval
- Secure remote web demo through an authenticated gateway (never expose this local server raw)

MIT licensed. See `LICENSE`.

## Next steps and project handoff
- [Competition participation and submission playbook](docs/HACKATHON_PLAYBOOK.md)
- [Self-sufficient Codex handoff](docs/CODEX_HANDOFF.md)
