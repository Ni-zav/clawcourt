# Kimi K3.1 Pro × Cerebras × OpenClaw: ClawCourt playbook

Checked on 22 November 2026 (WIB) against the [official guide](https://docs.google.com/document/d/1Vvf2SjScBt3yBeTVZRoKtOyE7rGEP-gWV_ApzwXepEQ/edit) via its public text export. ClawCourt has a verified OpenClaw run on local Ollama. Kimi K3.1 Pro on Cerebras access, qualifying usage, and submission eligibility remain unverified. Consult the organizers for any team or deadline changes.

## Eligibility: no substitution

- Capacity application for Kimi K3.1 Pro private preview has closed. Organizer says it cannot accept late requests.
- To compete for *any* listed prize, OpenClaw **and** Kimi K3.1 Pro **on Cerebras** must be central to the project. Other providers, local Ollama, or mock simulations are not substitutes.
- A preexisting scaffold is allowed, but substantive core work must occur during the hackathon.
- Project must be demonstrated in a video <=60 seconds; X post must tag `@Cerebras`, `@Kimi_Moonshot` and `#KimiOnCerebras`. Reddit can be used as an additional audience-choice entry, with the r/cerebras **Kimi K3.1 Pro Hackathon** flair. The video must show how Cerebras speed benefits the project. Include the project name, team handles, and a short project description.
- Public X and Reddit demos use **standard** OpenClaw, not the speed patch. The Speed Bounty is a **different task** and not suitable for ClawCourt unless separately implemented with official rules.
- Submission cutoff is **Sunday Nov 22, 2026 at 10:00 AM PST = Monday Nov 23, 2026 at 1:00 AM WIB**.
- Prize tally for X and Reddit is on Tuesday Nov 24 at 10:00 AM PST; organic engagement only. No paid boosts, bots, or vote manipulation.

## Best path with no preview access

1. Ask moderators in `#hackathon-support`: Are public noncompetitive demos welcome? Can an entrant join a team that was approved for preview access? Does a compliant *team run* using their authorized key count for the new teammate? Don't assume.
2. Simultaneously post in `#hackathon-chat` looking for an approved teammate who wants a prebuilt, independently tested OpenClaw project.
3. Keep the ClawCourt code vendor-agnostic and use the included keyless simulation while awaiting a reply.
4. If no eligible team forms, publish it as a **community/open-source project**, not an official prize-eligible entry. You can still meet developers, get feedback, and carry the product into another event.
5. If approved to join a team, have an authorized teammate actually configure Kimi K3.1 Pro on Cerebras and run a **real** OpenClaw demonstration. Do not share raw API secrets through Discord or screenshots; remove simulations from the official demo.

## Local model setup without Cerebras

You can run the real OpenClaw harness using a separate local provider. See the official [OpenClaw Ollama guide](https://docs.openclaw.ai/providers/ollama/setup).

On a Mac with a supported Ollama installation, an example small local model is:

```bash
ollama pull qwen3.5:4b
openclaw onboard   # choose Ollama, local-only; verify model supports tools
openclaw models list --provider ollama
CLAWCOURT_ENABLE_OPENCLAW=1 CLAWCOURT_MODEL=ollama/qwen3.5:4b npm start
```

The small `qwen3:0.6b` model was sufficient for ClawCourt’s incident smoke test. See [validation](VALIDATION.md) for versions, context settings, and evidence. Choose a model with suitable tools, context, and memory for your own task.

## Competition model route — only if authorized

The official preview model ID is `moonshotai-kimi-k3.1-pro-trial` on the standard Cerebras API. OpenClaw documents a Cerebras provider model prefix of `cerebras/`. Therefore the *candidate* OpenClaw reference is `cerebras/moonshotai-kimi-k3.1-pro-trial`, but because this private model may not appear in the discovered model catalog, a provider configuration might be required. Do not claim this combination has been tested.

Verify with `openclaw models list --provider cerebras`, and check the official hackathon support channel. Only use the private-preview token for the authorized organization.

## 60-second video shot list

- 0–7s: "How often does an AI agent say DONE when its tests don't pass?"
- 7–23s: A real OpenClaw agent submits a task; show its response followed by **failed** independent evidence (use a real run, not a demo simulation, for an official entry).
- 23–40s: Fix is implemented; verify the same acceptance criteria and show verified checks. If measuring Cerebras speed, capture **real** execution metrics; never fabricate TPS or claim end-to-end duration is tokens/second.
- 40–52s: Open receipt with file fingerprint, model/provider, tests and timestamp.
- 52–60s: "ClawCourt: the agent makes claims. Evidence decides."

## X sample post — publish only when eligibility actually holds

> My AI agent said it fixed the bug. The tests disagreed. ⚖️
>
> Built ClawCourt: independent file + test verification and evidence receipts for OpenClaw agents. Demonstrating Kimi K3.1 Pro running on Cerebras [only if tested and used]. 60-second demo attached; source: [actual repository URL].
>
> @Cerebras @Kimi_Moonshot #KimiOnCerebras

If the Kimi/Cerebras requirement is not fulfilled, share a normal open-source launch post instead, without representing it as an eligible entry.

## Source repository

Track the open-source project and validation evidence at [Ni-zav/clawcourt](https://github.com/Ni-zav/clawcourt). Keep local receipts, credentials, and configuration secrets out of commits and public demos.
