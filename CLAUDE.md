# CLAUDE.md — PassportKit Node

Reusable **onchain-identity + compliance-credential kit**. ETHGlobal Lisbon 2026 (Continuity track), forked from the public PassportCreds demo. Compliance credential rails for wallets, apps, **and agents**.

Thesis: *identity before access, compliance before liquidity.* **The demo hero is the REFUSAL (revocation), not the green check.**

---

## Core architecture — SOURCE OF TRUTH (do not drift)

- **Model B ("no privileged writer"):** the user's wallet is the MANAGEMENT key of their own **Identity** (ERC-734 keys + ERC-735 claims). The **ClaimIssuer** only SIGNS claims off-chain (EIP-712); the holder submits their own signed claim. Nobody writes to another's identity. Trust = the signature.
- **EligibilityGate** = the ONE read every surface uses: `isEligible(identity, policyId) → (bool ok, bytes32 reason)`. It loops the trusted issuers (from **IssuerRegistry**), reads the claim off the Identity, and **re-verifies with the ClaimIssuer at read time** (authoritative — the holder can't override a platform decision).
- **Revocation = an issuer-held LATCH** on the ClaimIssuer: `setRevoked(identity, topic, bool)`. While latched, `isClaimValid` is false → the gate refuses AND no fresh claim can land (submitClaim also calls isClaimValid). Only the issuer re-opens. Stronger than by-signature revocation.
- **4 enforcement surfaces** all consume the SAME gate: gated app (Deal Room), **GatedERC20** (transfer gate), **ENS read-through resolver**, **Uniswap v4 hook**.
- **Free-exit principle:** compliance blocks movement to a counterparty (transfer/swap), never your own exit (burn / removeLiquidity). Never trap funds.
- **Zero PII on-chain:** claim `data` = `abi.encode(dataHash, expiresAt, nonce)` — a hash/reference only, never PII. Expiry lives in the signed `data` (enforced by ClaimIssuer.isClaimValid), NOT a separate param.
- **Money moment:** revoke one claim → every surface refuses at once.
- **Chain:** Ethereum Sepolia (L1) — ENS core + Uniswap v4 are co-located there.

## Agent identities (x402) — IN DESIGN
An Identity is not only for a person. A person can spawn an **x402 agent** that gets a **subname of their identity** and acts under the person's credentials: the agent's actions are gated by the PERSON's eligibility (**revoke the person → their agents are blocked too**). This is the "eligibility infrastructure for humans AND agents" story (unlocks World AgentKit + ENS-for-AI-Agents angles). Detailed design: `docs/specs/agent-identity-spec.md` (WIP).

## Contracts (`contracts/`, Foundry)
`Types.sol` (shared vocab) · `Identity` · `IdentityFactory` · `ClaimIssuer` · `IssuerRegistry` · `EligibilityGate` · `GatedERC20` · `ens/PassportResolver` (tenant-aware read-through) · `ens/PassportSubnameRegistrar` · `ComplianceHook` (Uniswap v4).

## Conventions
- Solidity `^0.8.24` (solc 0.8.24), **Apache-2.0**, OpenZeppelin v5 (`@openzeppelin/contracts/...`), forge-std. **ASCII-only in string literals** (solc rejects unicode).
- Run the contract tests with `forge test` (the legacy PassportCreds contracts + tests were removed).
- Specs: `docs/specs/`. Vibe-coding prompts: `docs/prompts/`.

## Git workflow — IMPORTANT (multiple agents work this repo)
- **Multiple Claude agents run CONCURRENTLY on this repo.** ALWAYS run `git branch --show-current` right before committing/pushing — the branch can change under you.
- Flow: `feature/<lane>-<thing>` → PR → `develop` → (milestone) `main`. Never commit directly to `develop`/`main`.
- **Commit locally; do NOT push automatically** — the human reviews before push.
- AI code reviews (Copilot) are **advisory**: apply genuine fixes, reject architecture drift. This file + `docs/specs/` are the source of truth.
- Never add `Co-Authored-By` lines to commit messages.

## Boundaries
- This repo is **new, public** code only. Never bring in private production code; keep internal company/contract names out of committed files.
- World ID = real personhood. KYC / accredited = **labeled mocks**. No hard-coded demo values (ENS resolves live).
