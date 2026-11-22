# ClawCourt

ClawCourt runs an OpenClaw task, checks the workspace afterward, and records an acceptance receipt. A receipt includes the agent's statement, the checks you chose, and the target file's SHA-256 before and after execution. You can also check work produced by a person, another agent, or CI using **Verify only**.

## Quick start

ClawCourt needs Node.js 20 or newer and has no npm dependencies.

```sh
npm start
```

Open [ClawCourt on loopback](http://127.0.0.1:4173). Each simulation starts with a fresh copy of the incident fixture and checks the actual file and test exit code.

| Simulation | Acceptance | Verdict |
| --- | --- | --- |
| False claim | File exists with the wrong text. Test fails. | Unverified |
| Fix applied | File changes. Required text and test pass. | Verified |
| Agent failed | File starts fixed and all checks pass. | Agent failed |

Simulations carry **SIMULATED · NO AI** in the UI, clipboard summary, and receipt. They run without credentials, network access, or an installed OpenClaw CLI.

## Check your own work

```sh
CLAWCOURT_WORKSPACE=/absolute/path/to/disposable-checkout npm start
```

Choose **Verify only** and enter a workspace-relative regular file plus a case-sensitive text fragment. This mode can verify existing work before a review or release. Use **Export JSON receipt** to share the findings after checking the receipt for sensitive data.

The file check searches for the exact text anywhere in the file. For stronger evidence, enable a reviewed test or build command with `CLAWCOURT_ALLOW_WORKSPACE_COMMANDS=1`, then choose it in the form. Test suites and build scripts can execute repository code, so use a trusted, disposable checkout and review acceptance logic before relying on the verdict.

## Run OpenClaw with a configured provider

Install a version that supports `openclaw agent exec`. The [OpenClaw CLI documentation](https://docs.openclaw.ai/cli/agent#agent-exec) and its local `--help` list the flags available in your version. ClawCourt was tested with 2026.11.6. OpenClaw has its own Node.js requirements.

1. Configure a provider and tool policy in OpenClaw. For keyless local inference, use the [Ollama setup guide](https://docs.openclaw.ai/providers/ollama/setup). Use at least 16K of model context for the tested Ollama setup.
2. Start ClawCourt with OpenClaw enabled. Specify an optional model OpenClaw already knows, or omit it to use OpenClaw's default.

   ```sh
   CLAWCOURT_ENABLE_OPENCLAW=1 \
   CLAWCOURT_MODEL=ollama/qwen3:0.6b \
   npm start
   ```

3. Choose **OpenClaw**, start with the incident task and **File checks only**, then inspect the receipt. A default run uses a temporary copy of the fixture. Set `CLAWCOURT_WORKSPACE` to retain agent changes in a disposable checkout you control.

ClawCourt sends the task via stdin to `openclaw agent exec --message-file - --cwd <workspace> --json --timeout 180`. The optional `CLAWCOURT_OPENCLAW_CONFIG` selects an absolute path to a pinned config. `CLAWCOURT_OPENCLAW_BIN` selects a local binary. `CLAWCOURT_MODEL` and comma-separated `CLAWCOURT_FALLBACKS` map to OpenClaw's model and ordered fallback flags. Provider credentials belong in OpenClaw's configuration or environment.

An **OPENCLAW CLI** receipt records a launched process, its elapsed wall time, and any provider, model, or usage the CLI reported. An unavailable CLI produces an **OPENCLAW UNAVAILABLE** receipt. Older saved receipts without provenance are labeled historical or simulated. A successful agent run becomes **Verified** only if the selected acceptance checks also pass.

### Optional Cerebras route

With authorized access, configure the [OpenClaw Cerebras provider](https://docs.openclaw.ai/providers/cerebras), validate the model by running it via OpenClaw, and select it through `CLAWCOURT_MODEL`. The preview model reference to validate is `cerebras/moonshotai-kimi-k3.1-pro-trial`. Availability depends on the authorized organization and provider catalog.

This project demonstrated local Ollama inference. A prize claim requires the official Kimi K3.1 Pro on Cerebras workflow and a compliant submission. See the [hackathon playbook](docs/HACKATHON_PLAYBOOK.md).

## Boundaries and receipts

- ClawCourt binds to loopback, checks the host and request origin, and runs one trial at a time. Run one ClawCourt server per checkout and receipt store.
- A workspace path limits ClawCourt's file inspection. OpenClaw tools and workspace commands run with their own local permissions. Use a separate OS account, container, or VM for untrusted work.
- ClawCourt rejects hidden path components, symlinks, hard links, and target files over 2 MB. A failed or timed-out command fails its acceptance check. A command that changes the target during verification also fails acceptance.
- Treat receipts as local evidence for the selected checks. Review test changes, consider pre-existing evidence, and verify the diff independently before accepting work. The receipt exposes unchanged fingerprints when a criterion already held.
- The last 100 receipts live in `.data/runs.json` and may include tasks, acceptance criteria, replies and test output. Redaction catches common patterns. Keep secrets out of inputs and inspect exports before sharing. Remove `.data/runs.json` with the server stopped to clear history.

## Development

```sh
npm test
npm run check
```

The HTTP integration tests use ephemeral loopback ports and temporary receipt stores. See [validation and remaining work](docs/VALIDATION.md) for live, offline, and browser evidence.

MIT licensed. See [LICENSE](LICENSE).
