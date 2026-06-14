# Architecture — PassportCreds by Node

## Actors

| Actor | Role |
|---|---|
| **User** | Wallet owner. Connects via Privy embedded wallet, uploads compliance evidence, receives a soulbound passport. |
| **Frontend** | Next.js app. Reads passport state. Never writes onchain directly. |
| **Backend (NestJS)** | Session orchestrator. Calls AI Attester, receives webhook, stores sanitized result, triggers CRE. Never writes onchain. |
| **Chainlink Confidential AI Attester** | Evaluates compliance documents inside a TEE (Gemma4). Returns structured verdict. No PII escapes the enclave. |
| **Chainlink CRE** | The only authorized onchain writer. Fetches sanitized result from backend, validates, hashes identifiers, writes to smart contracts. |
| **ClaimRegistry** | Stores verified claims per wallet. Only CRE can write. |
| **CompliancePassport** | Soulbound ERC-721 + ERC-5192 passport. Minted on first verified claim. Status derived from ClaimRegistry. |
| **AccessGate** | Stateless read-only contract. Answers `canAccessDealRoom` and `canAccessInvestorArea` by reading ClaimRegistry and CompliancePassport. |

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, TailwindCSS, Privy embedded wallet |
| Backend | NestJS, Prisma ORM, PostgreSQL |
| CRE workflow | TypeScript, viem, Chainlink CRE |
| Smart contracts | Solidity, Foundry, ERC-721 + ERC-5192 |
| AI evaluation | Chainlink Confidential AI Attester (Gemma4 in TEE) |
| Infrastructure | Vercel (frontend) · Railway (API + CRE + PostgreSQL) |
| Network | Base Sepolia |

## Data Flow

```
User (Privy wallet)
  → Frontend
  → Backend: start verification session
  → Chainlink Confidential AI Attester: document + callback URL
  → TEE evaluates document (Gemma4)
  → Webhook POST to Backend: structured verdict
  → Backend: store sanitized result, trigger CRE with verificationId only
  → CRE: fetch sanitized result, validate, hash identifiers
  → CRE → ClaimRegistry.submitClaim (onchain tx)
  → CRE → CompliancePassport.syncPassport (onchain tx — SBT minted/updated)
  → CRE → AccessGate.getAccessSummary (read — no gas)
  → CRE → Backend: tx hashes + access result
  → Frontend: show badges, passport status, deal room state
```

## Key Design Decisions

- **Backend never writes onchain** — CRE holds `CRE_UPDATER_ROLE` exclusively
- **Only `verificationId` crosses the backend → CRE boundary** — no PII, no raw documents, no AI prompt
- **Only `keccak256` hashes written onchain** — `verificationIdHash` and `attestationHash`; no PII ever
- **Soulbound passport** — ERC-5192 locks the token; non-transferable, one per wallet, revocable by admin
- **Replay protection** — `verificationIdHash` stored permanently in ClaimRegistry; duplicate submissions revert
- **Passport status is derived, not stored** — `CompliancePassport.computeStatus` reads ClaimRegistry live; no stale state
- **Demo fallback** — if CRE is unavailable, backend can sync onchain directly via `OnchainContractAdapter`
- **Two claims only** — `KYC_AML_VERIFIED` and `ACCREDITED_INVESTOR`; no scope creep for the hackathon

## Passport Status Model

```
NONE          — no claims
IN_PROGRESS   — verification running
LIMITED       — KYC/AML verified, Accredited Investor not yet verified
GREEN         — both claims verified (full access)
RED           — KYC/AML failed (hard block)
REVOKED       — admin revoked the passport
EXPIRED       — claims past expiry date
```
