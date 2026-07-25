# WHAT'S NEW — PassportKit Node (ETHGlobal Lisbon 2026, Continuity Track)

> Continuity submission. This file separates the **pre-existing baseline** (prior work) from the **delta built during the 36-hour window** (Fri Jul 24 21:00 → Sun Jul 26 08:00 WEST).
> *The base is disclosed. The delta is the project.*

---

## 2026-07-25 — Uniswap v4 hook + House Concierge Agent

- **Uniswap v4 `ComplianceHook` + local demo** (PR #1) — the AccessGate that guards the
  Deal Room now also guards a v4 pool: `beforeSwap` / `beforeAddLiquidity` revert
  `NotCompliant(wallet, reasonCode)`, exit is deliberately ungated. Self-contained demo
  app (`apps/hook-demo`, `make hook-demo` → :4180) with self-healing anvil boot, two
  pools showing policy separation, and a built-in tx inspector.
- **Caller-bound `DemoPositionRouter` fix** — the demo liquidity router now binds
  positions to the calling actor instead of the router address, so per-actor LP
  positions read back correctly (and the hook sees the real provider).
- **House Concierge Agent** — new agents layer: `HouseToken` (CASA scrip),
  `HouseTreasury` (owners, m-of-n approvals, agent mandate, payment queue,
  `isAgentInGoodStanding`) and `MandateHook` (gates the CASA/mUSD pool). Two spending
  rails — autonomous below the per-tx cap (exact-output swap CASA→mUSD through the
  gated pool, then settle the vendor's **x402** invoice: 402 → pay → retry with
  `X-PAYMENT`), owner-approved above it — both gated on the owners' live passports, so
  revoking one owner's KYC kills the agent on both rails in the same block. Mock x402
  vendor server included; decision engine is a **0G-ready adapter**
  (`DECIDER=mock|openai|zerog`) whose TEE attestation replaces the local decision hash
  at event time. Runtime + UI in `apps/concierge` (`make concierge-demo` → :4190).
- **Tests:** 29 new Solidity tests (HouseToken 4, HouseTreasury 18, MandateHook 7 —
  93 green in `contracts/`) and 28 new JS tests (`apps/concierge`: decider rules, x402
  client, evidence hashing, revert decoding).

---

## Baseline (prior work — NOT judged as new)
- **Project:** PassportCreds by Node — our ETHGlobal build (claim registry, soulbound passport, access gate, Deal Room).
- **Repo / commit:** `[baseline repo URL]` @ `[baseline commit hash]` — imported in the initial commit, labeled `pre-existing baseline`.
- **What it already did:** Privy embedded-wallet onboarding, passport dashboard, a gated Deal Room, a NestJS backend with a verification/webhook flow.

---

## Reused from baseline (kept, adapted)
App shell — so the 36h go to the delta, not to rebuilding auth/UI:
- **Onboarding:** Privy embedded wallet (`PrivyAppProvider`, `PrivyLoginButton`, `WalletSetupCard`).
- **Gated app (enforcement surface):** the Deal Room (`app/deal-room/*`, `DealRoom{Locked,Limited,Unlocked,Blocked}`) — repointed to read the new `EligibilityGate`.
- **Dashboard:** passport dashboard components (`PassportCard`, `ClaimStatusBadge`, `EvidenceCard`, `TransactionTimeline`, `AccessDecisionBanner`, …).
- **Backend scaffolding:** NestJS + Prisma, the `attester` module (evolved into the issuer signing service), the webhook receiver, viem plumbing.
- **Optional:** `CompliancePassport` (ERC-721 + ERC-5192) reused as the soulbound badge pointing to the identity.

---

## New this weekend (the delta — judged)
Built in-event, incremental commits, from the specs in `docs/`:

**Contracts (Ethereum Sepolia):**
- **OnchainID Identity** (ERC-734/735) — replaces the old ClaimRegistry; issuer-signed claims, Model B writes.
- **IdentityFactory** — one Identity per wallet; resolves `wallet → identity` for the surfaces.
- **ClaimIssuer** (EIP-712) — signs claims; the holder submits them. No privileged writer. Revocation is an issuer-held latch (`setRevoked`).
- **IssuerRegistry** — trusted issuers per claim topic.
- **EligibilityGate** — `isEligible(identity, policyId) → (bool, reasonCode)`; the one read enforced everywhere.
- **GatedERC20** — permissioned transfer gate (`_update` → EligibilityGate; exits always free).
- **PassportResolver** — ENS **read-through** resolver, **tenant-aware** (text records computed live from the gate; one resolver serves N white-labels).
- **PassportSubnameRegistrar** — issues ENS subnames **by code** (the white-label/kit piece).
- **ComplianceHook** — Uniswap v4 hook gating swaps/liquidity by eligibility (proven by test suite).

**Integrations & services:**
- **World ID** — real proof-of-personhood (Identity Attestations + Selfie Check) → claims.
- **Mock evidence attester** — labeled placeholder for KYC/accredited (never described as regulated verification).
- **Issuer signing service** — EIP-712 claim signing.
- **ENS** — `passportkit.eth` (new brand) on Ethereum Sepolia + per-identity subnames issued by code (white-label proof with one tenant).

**The demo is the refusal:** revoke one claim → transfer fails + swap reverts + gated app closes + ENS record flips — because all four surfaces read the same `isEligible`.

---

## Boundaries / honesty
- **Nothing from our private production codebase** is in this repo — one sentence in Q&A only.
- **World ID is real** (personhood). **KYC/accredited are labeled mocks**; regulated/TEE providers plug into the same interface later.
- **No hard-coded demo values.** ENS resolves live.
- **AI-assisted, attributed:** see `AI-USAGE.md`; specs + prompts ship in `docs/`.

## Addresses
See `README.md` → address table (`[filled at submission]`).
