# Spec — House Concierge Agent (policy layer + gated budget pool)

> Surface #5 of PassportCreds: AI agents whose authority derives from verified humans.
> Example deployment: a house ("Casa Azul") with human owners and an AI concierge that
> autonomously handles routine expenses and escalates anything above threshold to the
> owners. Builds on the shipped stack (ClaimRegistry / CompliancePassport / AccessGate)
> and the v4 ComplianceHook — **zero changes to deployed core contracts**.
>
> Status: designed 2026-07-25, not yet implemented. Companion analysis in
> `ETHLisbon2026/FINAL/doc/` (outer prep repo).

> **Status: implemented** (2026-07-25) — contracts in `contracts/src/agents/` +
> `contracts/src/hooks/MandateHook.sol`, runtime and UI in `apps/concierge/`
> (`make concierge-demo` → :4190, mock x402 vendor on :4191). 29 Solidity tests
> (HouseToken 4 · HouseTreasury 18 · MandateHook 7) + 28 node:test. Deltas found
> during implementation:
>
> - **Rail 1 uses exact-*output* swaps.** §4 says "swap CASA→mUSD"; an exact-input
>   swap of `amount` CASA nets less than `amount` mUSD (0.3% pool fee) and cannot
>   settle the invoice. The agent therefore asks for exactly the invoice in mUSD and
>   spends slightly more CASA. Consequence for §3.3: the hook reads
>   `|SwapParams.amountSpecified|`, so **`perTxCap` is enforced against the invoice
>   value**, not the CASA spent — the intended semantics, but worth stating.
> - **2% budget haircut in the decider context.** Because of the above, the runtime
>   hands the decider `casaBalance * 0.98` as the available budget; otherwise a ticket
>   sitting flush against the balance decides `pay` and then reverts on the swap with
>   `ERC20InsufficientBalance`. Purely a runtime guard — no contract state involved.
> - **Refusal-reason fallback from standing.** §3.2's rail-2 reverts are bare
>   (`NotAgent()` carries no reason code), unlike the hook's
>   `NotAuthorized(wallet, reason)`. The server falls back to
>   `isAgentInGoodStanding` and reports that reason, so both rails name *why* the
>   agent lost authority. Also: mandate legs are checked before owner legs, so a
>   timewarp past expiry surfaces `MANDATE_EXPIRED` even though the owners' claims
>   expired in the same jump.
> - **Evidence is hashed everywhere, anchored on rail 2 only.** §5 implies every
>   payment carries an `evidenceHash` on-chain; in practice only `proposePayment`
>   stores one. Rail-1 decisions are hashed and surfaced in the UI but leave no
>   on-chain evidence pointer — anchoring routine decisions is roadmap.
> - **`DECIDER` adapter is env-selected** (`mock|openai|zerog`, default `mock`);
>   `openai` falls back to the mock rules on any error or malformed response, and
>   `zerog` is an event-time stub that throws with the exact broker SDK call sequence
>   it will make. The `subgraph` ChainData adapter of §5 is not built — reads are
>   direct RPC.
> - **Single-owner grant simplification stands as specced** (§3.2): both
>   `grantMandate` and `revokeMandate` are callable by any single owner; production
>   would gate grants behind the m-of-n threshold.
> - **Mock vendor is client-priced with no invoice registry** — the x402-style
>   402 → pay → retry flow is real, but the amount comes from the caller rather than
>   a quote the vendor issued; a signed quote/invoice registry is event-day hardening.

## 1. Thesis

Agents cannot KYC. Instead of pretending they can, the concierge's authority is a
**mandate granted by passport-holding humans and only valid while those humans stay
compliant**. Every enforcement point re-checks the owners' live passports through
AccessGate — so "one revoke flips all surfaces" now includes the AI: revoke one
owner's KYC and the agent instantly loses both its market access and its treasury.

## 2. Entities

| Entity | Onchain form | Compliance basis |
|---|---|---|
| House ("Casa Azul") | `HouseTreasury` contract (its address is the house) | n/a — container |
| Owners (humans) | wallets with PassportCreds passports | own KYC claims, LIMITED/GREEN |
| Concierge (AI agent) | plain wallet controlled by the agent runtime | **derived**: valid mandate ∧ all required owners compliant |
| Vendors (plumber…) | wallets + x402 HTTP endpoints | out of scope (roadmap: vendor passports) |

## 3. Contracts (new, in `contracts/src/agents/`)

### 3.1 `HouseToken` (CASA)
ERC-20 house scrip, one per house. `mint` only by the house's treasury; `reclaim(from,
amount)` lets the treasury claw back (it is an allowance voucher, not money). The
concierge's **routine budget = its CASA balance** — a hard, visible, onchain ceiling.

### 3.2 `HouseTreasury`
The governance spine. Holds the house's mUSD; deploys/owns its `HouseToken`.

State: `owners[]`, `approvalThreshold` (m-of-n), `mandate` (agent address, `perTxCap`,
`expiresAt`, `revoked`), pending payments queue. The spending controls are the
per-transaction cap and the agent's CASA budget — there is no daily accounting.

Functions (shape):
- `fundConcierge(casaAmount)` — owner-only: mints CASA to the agent (top-up of the
  autonomous budget). Owners separately LP mUSD into the gated pool.
- `proposePayment(vendor, amount, evidenceHash)` — agent-only: files an
  above-threshold payment.
- `approvePayment(id)` / `executePayment(id)` — owners approve m-of-n; execute pays
  mUSD from treasury and stores `evidenceHash`.
- `revokeMandate()` / `grantMandate(agent, perTxCap, expiresAt)` — callable by **any
  single owner** (revoke is a fast brake by design; single-owner grant is a stated
  hackathon simplification — production would gate grants behind the m-of-n threshold).
- **`isAgentInGoodStanding(wallet) → (bool, bytes32 reason)`** — the single view every
  surface gates on: wallet is the mandated agent ∧ mandate unexpired/unrevoked ∧
  **every owner passes `AccessGate.canAccessDealRoom` live**. Reason codes in the
  ComplianceHook style: `NO_MANDATE`, `MANDATE_EXPIRED`, `MANDATE_REVOKED`,
  `OWNER_NOT_COMPLIANT`.

Reverts follow house style (`NotAgent`, `AlreadyApproved`, `ThresholdNotMet`, …).

### 3.3 `MandateHook`
Sibling of `ComplianceHook` (same BaseHook skeleton, v4 deps already in the repo;
`ComplianceHook` itself is untouched — PR #1 stands). Gates the **CASA/mUSD pool**:
`beforeSwap` + `beforeAddLiquidity` allow only
(a) compliant owners of the house (top-up/LP), or
(b) `isAgentInGoodStanding` agents (swapping CASA→mUSD) — agent swaps are additionally
bounded by `mandate.perTxCap` (the hook reads `SwapParams.amountSpecified`), so the
per-transaction cap is enforced at the market, onchain.
Exit (remove liquidity) is never gated. Actor via hookData as in ComplianceHook, same
trust caveat. Reverts `NotAuthorized(wallet, reason)`.

## 4. The two spending rails

**Rail 1 — routine (autonomous):** ticket → agent decides → swap CASA→mUSD through the
MandateHook pool → settle the vendor's x402 invoice from the agent wallet. Triple
fence: CASA balance (budget), hook (live compliance standing), pool depth (owners'
topped-up liquidity). `perTxCap` bounds any single swap.

**Rail 2 — above threshold:** amounts beyond the agent's budget/cap → `proposePayment`
→ owners approve m-of-n → treasury pays mUSD directly. The approval queue is the
deferred-execution surface (no keepers, no cron).

**Kill-switch:** owner KYC revoked ⇒ both rails refuse the agent in the same block.
Mandate revoked ⇒ same. CASA reclaimed ⇒ budget gone.

## 5. Agent runtime — `apps/concierge/`

Node service in the hook-demo house style (zero framework, viem, node:test):

- **Ticket intake** — `POST /tickets {description, vendor, quoteAmount, category}`.
- **Decision engine** — adapter interface `decide(ticket, context) → {action:
  pay|propose|reject, rationale, confidence}`:
  - `mock` (default): deterministic rules — category allowlist, quote vs caps.
  - `openai`: any OpenAI-compatible endpoint (env-configured).
  - `zerog`: stub whose methods name the exact 0G broker SDK calls
    (`@0gfoundation/0g-compute-ts-sdk`, TEE-verified inference) — wired live at the
    event; its attestation replaces the local decision hash.
- **Evidence** — every decision serialized to JSON; `keccak256` stored onchain with
  the payment (`evidenceHash`) — the same attested-decision pattern as the Chainlink
  attester flow.
- **Executor** — viem: swap via the gated pool, x402 settlement, propose/monitor
  approvals.
- **Chain reads** — `ChainData` adapter: direct RPC now; `subgraph` adapter at the
  event (entities: House, Mandate, Ticket, Payment, Approval) → Graph AI continuity.
- **x402 vendor** — separate tiny mock server (`apps/concierge/vendor/`): quotes a
  job, returns HTTP 402 with payment requirements, verifies settlement, marks invoice
  paid.

## 6. Demo — `apps/concierge/` UI

PassportCreds branding, hook-demo skeleton reused (self-healing boot, tx inspector,
reset/timewarp local-only). Panels: house card (treasury mUSD, pool depth, agent CASA
budget), ticket feed with the agent's rationale per ticket, owner approval queue,
owner controls (fund concierge, revoke mandate, revoke owner KYC via existing issuer
flow), on-chain log.

Scripted beats: €120 faucet auto-paid (rail 1) → €4,500 roof queued + approved
(rail 2) → budget exhaustion → **owner-KYC-revoke kill-switch** → restore → mandate
revoke (until re-granted).

## 7. Testing

- **Forge** (`contracts/test/agents/`), against the real stack like ComplianceHook.t.sol:
  standing derivation incl. each reason code; both rails end-to-end; per-tx cap;
  m-of-n approval edge cases (double-approve, non-owner, execute-before-threshold);
  hook gating for owner vs agent vs stranger; exit always free; CASA reclaim;
  owner-revocation kill-switch on both rails in the same block.
- **node:test** (`apps/concierge/test/`): decision adapters (mock rules table),
  x402 client against the mock vendor, evidence hashing, decode helpers reused.

## 8. Documentation deliverables (part of the implementation, not an afterthought)

- `apps/concierge/README.md` — run instructions, actor table, demo script, API table,
  env template (`env.example`: RPC, explorer, keys, `DECIDER=mock|openai|zerog`,
  0G + subgraph placeholders).
- This spec updated to **Status: implemented** with any design deltas (as done for
  the hook spec).
- Root `README.md` — concierge row in the contracts table + short section with
  `make concierge-demo`.
- `CLAUDE.md` — agents layer summary (contracts, standing rule, adapter pattern).
- `Makefile` — `concierge-demo` target.
- Dated changelog entry (`WHATS-NEW.md`) — required evidence for 0G/continuity judging.

## 9. Prize & event plan (continuity-only assumption — reconfirm with organizers)

| Track | $ | What must be true |
|---|---|---|
| 0G Keep Building ($4.5k pot) | at event | `zerog` decider live via broker SDK, attestation onchain, dated changelog, prior-state link |
| Graph AI Use Case continuity ($4k) | at event | contracts on public testnet, subgraph deployed, agent reads live Graph data |
| Uniswap Stack continuity ($3k) | in PR #1 | MandateHook deepens the same submission |
| World Identity/Selfie continuity (2×$1.75k) | at event | owners verified via World as second attester — composes, separate workstream |
| Hedera continuity ($1k) | skipped | not worth a second chain; approval queue covers the beat |

## 10. Risks & limitations (stated, not hidden)

1. **hookData actor spoofing** — same caveat as ComplianceHook §3.1; hackathon
   assumption of trusted periphery, roadmap: actor signature binding.
2. **Agent wallet custody** — the runtime holds a hot key; mUSD obtained via rail 1 is
   unfenced after the swap. Mitigation is the budget ceiling itself; roadmap: pay
   vendors directly from a spend-bound splitter.
3. **Oracle-free pricing** — CASA/mUSD price is whatever the pool says; owners are the
   only LPs, so drift is a demo footnote, not a risk.
4. **0G availability** — decider falls back to `mock` if 0G is unreachable (same
   "Simulate Verified" philosophy as the product).
5. **Single-owner mandate grant is a blast radius** — because any one owner can
   `grantMandate`, that owner can name a wallet they control, mint unlimited CASA to
   it via `fundConcierge` and drain the pool's mUSD side through the gated pool
   (treasury-held mUSD is untouched — rail 2 still needs m-of-n). Accepted hackathon
   simplification; production gates grants behind the same threshold as payments.
