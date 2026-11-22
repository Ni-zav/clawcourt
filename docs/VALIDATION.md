# ClawCourt 0.2 validation

Validation took place on 22 November 2026 (WIB) on an Apple M4 Mac. The original archive is preserved outside the repository. The initial Git commit records the extracted scaffold.

## Automated and browser checks

| Check | Observed result |
| --- | --- |
| Original `npm test` | 6/8 passed. Two tests failed because macOS uses a symlink for the temporary directory and the original verifier compared canonical and noncanonical paths. |
| Updated `npm test` | 20/20 passed on Node.js 24.22.2 and 20.20.2. Includes actual local HTTP requests, simulation verdicts, a missing executable, request origin and Host policy, opt-in enforcement, parallel admission, evidence paths and limits, redaction, command timeout, mutation detection, and parser regression fixtures. |
| `npm run check` | All application and test modules passed syntax checks on both Node.js versions. |
| `git diff --check` | Passed. |
| `cd fixtures/playground && node --test` | The packaged baseline intentionally failed 1/1. The OpenClaw-edited copy passed 1/1 on an independent rerun. `cmp` confirmed the acceptance test itself matched the packaged version. |
| Google Chrome 157 with Playwright Core | At 1440 px and 390 px, ran the three simulations, checked verdicts, expanded the fingerprint details, inspected JSON download and copied summary, and reopened a receipt with the keyboard. No page errors or horizontal overflow at 390 px. |

Browser checks can be repeated by starting `npm start`, running each of the three simulations, and inspecting the result, expanded fingerprints, download, clipboard, and history. Select a 390 px viewport for the mobile check.

## Live OpenClaw integration

Installed OpenClaw 2026.11.6 (06afb10) and Ollama 0.40.17 into temporary directories. OpenClaw ran with a temporary home and a pinned config and had access to one disposable fixture. Ollama listened on `127.0.0.1:29143` with cloud disabled. The selected model was `qwen3:0.6b` at 16,384 context. The first attempt at Ollama's 4,096-token default failed with a provider context error. Increasing the daemon context resolved it.

1. `openclaw --version` and `openclaw agent exec --help` confirmed the installed version and stdin, config, cwd, model, JSON, and timeout flags.
2. `openclaw agent exec --isolated --cwd "$WORKSPACE" --model ollama/clawcourt-unconfigured --message-file - --json --timeout 10` exited 1 and returned a structured model error using a temporary home.
3. `openclaw agent exec --config "$CONFIG" --cwd "$WORKSPACE" --model ollama/qwen3:0.6b --message-file - --json --timeout 60` exited 0 and returned `CLAWCOURT_OK.` from real local inference.
4. Posting the request below to ClawCourt returned HTTP 201, `openclaw_cli` provenance, CLI exit 0, provider `ollama`, model `qwen3:0.6b`, and a **Verified** verdict. ClawCourt independently passed the two file checks and `node --test`. The changed SHA-256 and the 64 → 12 byte change are recorded in the receipt.

| Evidence | Result |
| --- | --- |
| Before SHA-256 | `9911bd62a024f1092b38782bc515614f95fd3e32ad145f9fc9748a73c0659fe0` |
| After SHA-256 | `8f67ff5f6d2c9355a13471537c7610294d39eba1a14155c5ebe765a2c1e4936b` |
| Agent process wall time | 31,408 ms for this observed run, including harness overhead |
| Verification | 3/3 checks, test process exit 0 |

See the [saved OpenClaw envelopes and incident receipt](../fixtures/openclaw/README.md). The successful run is an integration smoke test. Its elapsed time is a single end-to-end observation.

### Repeat the incident smoke test

Start [local Ollama](https://docs.openclaw.ai/providers/ollama/setup) with the loopback address and context size from the smoke run.

```sh
OLLAMA_HOST=127.0.0.1:29143 OLLAMA_CONTEXT_LENGTH=16384 OLLAMA_NO_CLOUD=1 ollama serve
```

From a second shell, run `OLLAMA_HOST=127.0.0.1:29143 ollama pull qwen3:0.6b`. The [pinned smoke config](../fixtures/openclaw/ollama-smoke.json) uses the minimal tool profile with explicit `read` and `write`, disables Code Mode and context injection, and denies shell, browser, and external communication tools. See the [CLI config options](https://docs.openclaw.ai/cli/agent#agent-exec).

From the checkout, use a fresh directory and the reviewed smoke config.

```sh
workspace="$(mktemp -d)"
cp -R fixtures/playground/. "$workspace/"
CLAWCOURT_WORKSPACE="$workspace" \
CLAWCOURT_ENABLE_OPENCLAW=1 \
CLAWCOURT_ALLOW_WORKSPACE_COMMANDS=1 \
CLAWCOURT_MODEL=ollama/qwen3:0.6b \
CLAWCOURT_OPENCLAW_CONFIG="$PWD/fixtures/openclaw/ollama-smoke.json" \
npm start
```

From a second shell:

```sh
curl --fail-with-body http://127.0.0.1:4173/api/runs \
  -H 'Content-Type: application/json' \
  --data '{"mode":"openclaw","task":"Use the write tool to overwrite incident.txt with exactly this one line: status=fixed","file":"incident.txt","expected":"status=fixed","command":"node_test"}'
```

Inspect the returned receipt and run `node --test` in the temporary workspace. A small model can give different results between runs.

## Limits and remaining work

- Live provider coverage is local Ollama. Cloud providers and the private Kimi/Cerebras model remain untested. The CLI's reported provider and model identify the observed run. They carry no independent provider attestation.
- Local defenses reduce accidental exposure. The server and arbitrary workspace processes are not an isolation boundary against a hostile same-user process or concurrent filesystem replacement. Use OS isolation for untrusted repositories. ClawCourt's busy guard and JSON history assume one server instance per store.
- The accepted suite can still contain weak or agent-edited checks. Future work includes separately pinned acceptance suites, Git revision and diff evidence, and automated test coverage on Linux and Windows.
- The official guide requires OpenClaw and Kimi K3.1 Pro on Cerebras as core components, substantive core work during the event, a demo up to 60 seconds demonstrating Cerebras speed, and a correctly tagged X post by Sunday 22 November at 10:00 a.m. PT (Monday 23 November at 1:00 a.m. WIB). An authorized preview run and a qualifying submission are outstanding. No hackathon submission or Speed Bounty benchmark was made. See the [official guide](https://docs.google.com/document/d/1Vvf2SjScBt3yBeTVZRoKtOyE7rGEP-gWV_ApzwXepEQ/edit) and [playbook](HACKATHON_PLAYBOOK.md).
