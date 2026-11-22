# OpenClaw smoke evidence

Captured on 22 November 2026 from OpenClaw 2026.11.6. The two CLI envelopes omit OpenClaw session IDs.

- `success.json` came from a real local Ollama completion using `qwen3:0.6b`. The prompt requested a short confirmation string.
- `unknown-model.json` came from the real CLI with an intentionally unconfigured local model. No model completed that request.
- `incident-receipt.json` came from the ClawCourt HTTP API after a real OpenClaw and Ollama tool run. The run modified a temporary incident fixture and ClawCourt invoked the fixture's acceptance test independently.

Historical evidence retains its original timing and usage where recorded. Automated tests reparse the saved envelopes without executing inference.
