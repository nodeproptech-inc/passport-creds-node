# WHAT'S NEW — PassportKit Node (ETHGlobal Lisbon 2026, Continuity Track)

> Continuity submission. This file separates the **pre-existing baseline** (prior work) from the **delta built during the 36-hour window** (Fri Jul 24 21:00 → Sun Jul 26 08:00 WEST).
> *The base is disclosed. The delta is the project.*

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
