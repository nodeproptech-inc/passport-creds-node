# AI Usage & Attribution — PassportKit Node

> ETHGlobal requires transparent AI attribution. This documents where and how AI tools were used, and what is human-authored. Spec-driven workflow: all **specs** (`specs/`) and **prompts** (`prompts/`) are in this repo so judges can see how the AI was directed — not just the output.

## Tools
- **Claude Code (Claude Opus)** — spec-driven pair: architecture discussion, spec authoring, contract/backend/frontend generation from specs, debugging.
- **ChatGPT** — secondary assistant (ideation, review).

## Human-authored (the judgment, not the typing)
All product and architecture decisions are human-made; AI executed against them. Key human decisions:
- Product thesis: compliance credential rails; **the demo is the refusal** (revocation).
- **Model B** claim writes (holder submits, issuer only signs) = canonical ONCHAINID — chosen over open-submit after analyzing the griefing vector.
- **Read-through ENS resolver** (records computed live from the gate) over static `setText`.
- **White-label / kit** design (tenant-aware resolver + subname registrar) → SDK direction.
- **Co-locate on Ethereum Sepolia** (read-through needs same-chain gate).
- **Free-exit principle** across surfaces (block movement to a counterparty, never your own exit).
- **IP boundary:** the private production ERC-3643 stack is NOT in this repo.
- Prize strategy, scope, cut order, demo sequence.

## How AI was used, by area
> Fill per-file annotations as you build (each commit notes AI assistance). Baseline files inherited from PassportCreds are prior work (see `WHATS-NEW.md`), not AI-generated this weekend.

| Area | AI role | Human role |
|---|---|---|
| `specs/`, `prompts/`, planning docs | drafted collaboratively with Claude | authored/decided all architecture + trade-offs |
| `contracts/` (9 Solidity contracts + tests) | generated from `contracts-build-spec.md` via the `prompts/` | reviewed, tested, committed incrementally; wrote acceptance criteria |
| `apps/api` (issuer signing service + adapts) | code generation from specs | integration, security review (EIP-712, no-PII), wiring |
| `apps/web` (dashboard/gated app adapts, World, ENS view) | code generation + component adaptation | UX decisions, demo flow, no-hard-coded sweep |
| ENS resolver/registrar | generated from `ens-spec.md` | design (read-through, tenant-aware), booth-validated |

## Integrity notes
- **Not "entirely AI":** the architecture, security model, and every design trade-off are human-directed and defensible in Q&A. The specs are the evidence.
- **World ID is real** (personhood). **KYC/accredited are labeled mocks.** No mock is described as regulated verification.
- **No hard-coded demo values.**
- Commits are incremental (no bulk drops); the pre-existing baseline is labeled.

_(Finalize per-file notes + the tools' exact usage at submission.)_
