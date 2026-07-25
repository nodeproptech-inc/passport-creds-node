# House Concierge demo

Local demo of the **House Concierge Agent** — an AI agent that pays a house's bills
with money it can only touch while its human owners stay compliant. Agents cannot
KYC; this one's authority is a **mandate granted by passport-holding owners**, and
every enforcement point re-checks those passports live through the same AccessGate
that guards the Deal Room.

Two spending rails, one standing check:

| Rail | Path | Bounded by |
|---|---|---|
| 1 — routine (autonomous) | ticket → decider → exact-output swap CASA→mUSD through the MandateHook pool → settle the vendor's x402 invoice | CASA budget · `perTxCap` enforced onchain by the hook · pool depth |
| 2 — above threshold | ticket → `proposePayment(vendor, amount, evidenceHash)` → owners approve m-of-n → treasury pays mUSD directly | owner approvals (threshold 2) · treasury balance |

**Kill-switch:** revoke either owner's KYC and both rails refuse the agent in the
same block (`OWNER_NOT_COMPLIANT`) — the mandate is unchanged, the humans behind it
simply stopped being compliant. Revoking the mandate (`MANDATE_REVOKED`) or letting
it expire (`MANDATE_EXPIRED`) does the same. Removing liquidity is never gated.

## Run

```bash
cd apps/concierge
npm install       # first time only
npm start         # → http://localhost:4190
```

Or `make concierge-demo` from the repo root. The server is self-healing: it starts
anvil if none is running, deploys the demo world
(`contracts/script/DeployConciergeDemo.s.sol`) if the treasury isn't on-chain, and
spawns the mock plumber (x402 vendor) on :4191. **↺ Reset world** resets the chain
(`anvil_reset`, clock included) and redeploys.

## Actors (anvil dev accounts)

| actor | role | starts with |
|---|---|---|
| operator | house owner #1 — contract admin, simulated CRE/issuer, LP | KYC-verified passport at deploy, LPs the CASA/mUSD pool |
| ana | house owner #2 — second signature on above-cap payments | KYC-verified passport at deploy |
| concierge | the AI agent (plain wallet, no passport) | 500 CASA budget, mandate: 200 mUSD per-tx cap, expires +365d |
| plumber | vendor, x402 HTTP endpoint on :4191 | nothing — gets paid in mUSD |

The house card shows treasury mUSD, pool depth and the agent's CASA budget; the
owner cards show each passport and its live claims; every ticket shows the decider's
action, rationale, confidence and the **evidence hash** of that decision.

## Decision engine (`DECIDER=`)

| mode | behaviour |
|---|---|
| `mock` (default) | deterministic rules — category allowlist (`plumbing`, `electrical`, `cleaning`, `admin`), amount vs `perTxCap` and remaining budget. No network, always demo-safe. |
| `openai` | any OpenAI-compatible `/chat/completions` endpoint (`OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_KEY`). Falls back to the mock rules on any error or malformed answer. |
| `zerog` | 0G decentralized inference — **event-time stub**: it throws with the exact broker SDK call sequence it will make (`createZGComputeNetworkBroker` → `ledger.depositFund` → `inference.getServiceMetadata` / `getRequestHeaders` → provider endpoint → `processResponse` for the TEE attestation). Wired live at the event; the attestation then replaces the local decision hash. |

The budget the decider sees is the raw CASA balance **minus a 2% haircut** — rail 1
sells CASA for *exactly* the invoice in mUSD, so it spends slightly more CASA than
the invoice (0.3% pool fee + price impact) and a ticket sitting flush against the
balance would otherwise decide `pay` and revert on the swap.

## Evidence

Every decision is serialized to canonical JSON and hashed (`keccak256`) — the same
attested-decision pattern as the Chainlink attester flow. Be precise about what that
buys you: **the hash is computed and shown in the UI for every ticket, but it is only
anchored on-chain for rail 2**, where `proposePayment` stores it with the payment.
Rail-1 payments carry no on-chain evidence pointer today (the swap and the ERC-20
transfer are the only traces) — anchoring routine decisions is roadmap, as is
replacing the local hash with the 0G TEE attestation.

## Transactions

- **Built-in inspector** — click any tx hash in the log: status, gas, and fully
  decoded events (`ClaimUpdated`, `PassportMinted`, `MandateGranted`,
  `ConciergeFunded`, `PaymentProposed`, `PaymentApproved`, `PaymentExecuted`,
  ERC-20 `Transfer`, …).
- **Testnet explorer** — set `EXPLORER_URL` in `.env` and hashes also link out
  (e.g. Etherscan on Sepolia).

## Demo script (~2 min)

1. **Leaky faucet — 120 mUSD** → within cap: the agent swaps CASA→mUSD through the
   gated pool and settles the plumber's `402` invoice (402 → pay → retry with
   `X-PAYMENT`). Two transactions, no human.
2. **Roof repair — 4500 mUSD** → over cap: the agent files `proposePayment` with the
   evidence hash anchored on-chain and stops. Queued, not paid.
3. **Approve as operator, then as ana** → threshold 2 met → the treasury executes and
   the plumber is paid from house funds.
4. **Revoke Ana's KYC** → submit any ticket: both rails refuse with
   `OWNER_NOT_COMPLIANT`. The agent's mandate never changed — the human behind it did.
   **Restore Ana's KYC** and it works again.
5. **Revoke mandate** → `MANDATE_REVOKED`; **Grant mandate** → back in business.
6. **⏩ Fast-forward 1 year** → the mandate expires (and the owners' claims with it) —
   the refusal reads `MANDATE_EXPIRED`, because mandate legs are checked before owner
   legs. **↺ Reset world** to run it again.
7. Click a **tx hash** — decoded events, straight from the chain.

Bonus beat: submit a ticket with a category outside the allowlist (e.g. `travel`) —
the decider rejects it before touching the chain, rationale and evidence hash included.

## API

```
GET  /api/state
GET  /api/tx/<hash>          receipt + decoded events
POST /api/ticket             {"description":"Leaky faucet","amount":"120","category":"plumbing"}
POST /api/approve            {"owner":"operator|ana","id":1}
POST /api/fund               {"amount":"500"}          mints CASA to the agent
POST /api/revoke-mandate     {}
POST /api/grant-mandate      {}
POST /api/revoke-owner-kyc   {"owner":"operator|ana"}
POST /api/restore-owner-kyc  {"owner":"operator|ana"}
POST /api/timewarp           {"days":366}              (local only)
POST /api/reset              {}                        (local only)
```

Refusals come back decoded: rail 1 from the hook's `NotAuthorized(wallet, reason)`
(wrapped in v4's `WrappedError`), e.g.
`{"ok":false,"reason":"OWNER_NOT_COMPLIANT","message":"NotAuthorized(0x90F7…b906, OWNER_NOT_COMPLIANT)"}`.
Rail 2 reverts bare (`HouseTreasury.NotAgent()` carries no reason code), so the
server falls back to `isAgentInGoodStanding` and reports the same reason from the
treasury's own view — refusals name *why* on both rails.

## Ethereum Sepolia

Copy `env.example` to `.env` and fill in: `RPC_URL`, `EXPLORER_URL`, funded
`OPERATOR_PK` / `ANA_PK` / `CONCIERGE_PK` / `PLUMBER_PK`, and `POOL_MANAGER`
(canonical v4 on Sepolia: `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`). Then:

```bash
cd contracts && set -a && source ../apps/concierge/.env && set +a && \
  forge script script/DeployConciergeDemo.s.sol --rpc-url $RPC_URL --broadcast
cd ../apps/concierge && npm start
```

Timewarp and reset are local-only; mandate-expiry demos need real time on testnets.

## Tests

```bash
cd contracts && forge test --match-path 'test/agents/*'   # HouseToken 4 · HouseTreasury 23 · MandateHook 9
cd apps/concierge && npm test                             # 35: decider rules, x402 client, evidence hashing, decoders
```

Spec and design notes: [`docs/specs/agent-concierge-spec.md`](../../docs/specs/agent-concierge-spec.md).
