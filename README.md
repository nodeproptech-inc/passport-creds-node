# PassportCreds by Node

**White-label Compliance Passport for regulated onchain access.**

Built for ETHGlobal · Chainlink · Base Sepolia

![Chainlink](https://img.shields.io/badge/Chainlink-CRE%20%2B%20Confidential%20AI-375BD2?logo=chainlink)
![Privy](https://img.shields.io/badge/Privy-Embedded%20Wallet-7C3AED)
![Base](https://img.shields.io/badge/Base-Sepolia-0052FF?logo=coinbase)
![NestJS](https://img.shields.io/badge/Backend-NestJS-E0234E?logo=nestjs)
![Next.js](https://img.shields.io/badge/Frontend-Next.js%2014-000000?logo=nextdotjs)

---

## Live Demo

**Frontend:** https://passport-creds-node-web.vercel.app/

**Infrastructure:**
- API + PostgreSQL: Railway
- CRE workflow: Railway
- Frontend: Vercel

**Contracts — Base Sepolia (all verified on Basescan):**

| Contract | Address |
|---|---|
| ClaimRegistry | [`0xE33f1BD4c360A035a9F62043A54BA9812f36d634`](https://sepolia.basescan.org/address/0xE33f1BD4c360A035a9F62043A54BA9812f36d634) |
| CompliancePassport | [`0x9EFd338b9E43577264665348Bd39548f5b044627`](https://sepolia.basescan.org/address/0x9EFd338b9E43577264665348Bd39548f5b044627) |
| AccessGate | [`0xD23c3e140d8FA5d81D1f9966A3093Dc38443cDF6`](https://sepolia.basescan.org/address/0xD23c3e140d8FA5d81D1f9966A3093Dc38443cDF6) |

---

## Origin

This project started from a real internal problem at **Node PropTech**.

We needed a way to verify that investors accessing a regulated deal room were KYC-cleared and accredited — without storing sensitive documents, without a fragile manual process, and without building a bespoke integration for every compliance provider we might work with.

As we thought about it more, we realised this is not a Node problem. Any platform dealing with regulated assets — real estate, private equity, tokenised securities — faces the exact same friction. The infrastructure for compliant onchain access simply does not exist in a reusable, privacy-preserving form.

That led us to PassportCreds: a white-label, protocol-agnostic Compliance Passport that any platform can embed. The concept aligns closely with the Creds protocol described in [this paper](https://arxiv.org/pdf/2606.03771), which explores verifiable credential systems for privacy-preserving identity. The Chainlink Confidential AI Attester turned out to be the perfect primitive — we discovered it almost by accident, and it fits the use case exactly: evaluate sensitive compliance documents inside a TEE without the document ever leaving the enclave.

During the build we used **Claude Code** (Claude Sonnet) and **ChatGPT** as coding assistants for scaffolding, debugging, and iteration. All product decisions and protocol architecture are human-authored.

---

## How It Works

1. User connects with **Privy Embedded Wallet**
2. Uploads a compliance document (KYC/AML or Accredited Investor evidence)
3. **Chainlink Confidential AI Attester** evaluates the document inside a TEE — no PII escapes the enclave
4. Verdict delivered via webhook to backend (Railway)
5. Backend triggers **Chainlink CRE** with `verificationId` only — no raw data, no PII
6. CRE fetches sanitized result, validates, and writes two onchain transactions to Base Sepolia
7. Soulbound Compliance Passport (ERC-721 + ERC-5192) minted or updated
8. **AccessGate** reads claims and passport — Deal Room unlocks

---

## Flow Diagram

```mermaid
flowchart TD

    A["User connects wallet<br/>Privy Embedded Wallet"] --> B["PassportCreds Frontend<br/>by Node<br/>Vercel"]

    B --> C{"Does wallet already<br/>have compliance claims?"}

    C -->|No| D["Start Compliance Flow"]
    C -->|Yes| X["Load Existing Passport<br/>and Claims"]

    D --> E["Upload Evidence 1<br/>KYC / AML Document"]
    E --> F["Chainlink Confidential<br/>AI Attester"]

    F --> G["Attested AI Output<br/>KYC_AML_VERIFIED"]
    G --> H["Railway Webhook<br/>POST /webhooks/ai-attester"]

    H --> I["Backend Receives<br/>AI Attester Result"]
    I --> J["Database Updated<br/>verificationId saved<br/>KYC / AML = Verified"]

    J --> K["Backend Triggers CRE<br/>passes verificationId only"]

    K --> L["Chainlink CRE Fetches<br/>Sanitized Result<br/>GET /cre/verification-result/:verificationId"]

    L --> M["CRE Validates Payload<br/>wallet, claimType, approved,<br/>attestationHash, expiresAt"]

    M --> N["Tx 1: ClaimRegistry.submitClaim<br/>KYC_AML_VERIFIED = true"]
    N --> N2["Tx 2: CompliancePassport.syncPassport<br/>Status = LIMITED"]

    N2 --> O["Frontend Updates Badge<br/>KYC / AML turns GREEN"]

    O --> P{"Is Accredited Investor<br/>claim verified?"}

    P -->|No| Q["Passport Status: LIMITED<br/>Deal Room unlocked<br/>Investor access blocked"]

    Q --> R["Upload Evidence 2<br/>Accredited Investor Document"]
    R --> S["Chainlink Confidential<br/>AI Attester"]

    S --> T["Attested AI Output<br/>ACCREDITED_INVESTOR"]
    T --> U["Railway Webhook<br/>POST /webhooks/ai-attester"]

    U --> V["Backend Receives<br/>AI Attester Result"]
    V --> W["Database Updated<br/>verificationId saved<br/>Accredited Investor = Verified"]

    W --> Y["Backend Triggers CRE<br/>passes verificationId only"]

    Y --> Z["Chainlink CRE Fetches<br/>Sanitized Result<br/>GET /cre/verification-result/:verificationId"]

    Z --> ZA["CRE Validates Payload<br/>wallet, claimType, approved,<br/>attestationHash, expiresAt"]

    ZA --> ZB["Tx 3: ClaimRegistry.submitClaim<br/>ACCREDITED_INVESTOR = true"]
    ZB --> ZC["Tx 4: CompliancePassport.syncPassport<br/>ERC-721 + ERC-5192<br/>Status = GREEN"]

    ZC --> ZD["Frontend Shows Passport Card<br/>Badges: KYC / AML · Accredited Investor"]

    ZD --> ZE["AccessGate Read Call<br/>canAccessDealRoom(wallet)"]
    X --> ZE

    ZE --> ZF{"Access Decision"}

    ZF -->|Allowed| ZG["Node PropTech Deal Room<br/>Unlocked"]
    ZF -->|Denied| ZH["Access Blocked<br/>Missing or Failed Claims"]

    subgraph FRONTEND["Frontend — Vercel"]
        B
        O
        ZD
    end

    subgraph BACKEND["Backend — Railway (NestJS + PostgreSQL)"]
        H
        I
        J
        K
        U
        V
        W
        Y
    end

    subgraph CRE["Chainlink CRE — Railway"]
        L
        M
        Z
        ZA
    end

    subgraph ONCHAIN["Onchain Transactions — Base Sepolia"]
        N
        N2
        ZB
        ZC
        ZE
    end

    subgraph CONTRACTS["Smart Contracts — Base Sepolia"]
        CR["ClaimRegistry<br/>Stores verified claims"]
        CP["CompliancePassport SBT<br/>ERC-721 + ERC-5192"]
        AG["AccessGate<br/>Grants or blocks access"]
    end

    N -.updates.-> CR
    N2 -.updates.-> CP
    ZB -.updates.-> CR
    ZC -.updates.-> CP
    ZE -.reads.-> CR
    ZE -.reads.-> CP
    ZE -.uses.-> AG

    classDef user fill:#eef2ff,stroke:#4f46e5,color:#111827;
    classDef frontend fill:#dbeafe,stroke:#2563eb,color:#111827;
    classDef ai fill:#fef3c7,stroke:#d97706,color:#111827;
    classDef backend fill:#ecfdf5,stroke:#059669,color:#111827;
    classDef cre fill:#ede9fe,stroke:#7c3aed,color:#111827;
    classDef chain fill:#f3e8ff,stroke:#9333ea,color:#111827;
    classDef success fill:#dcfce7,stroke:#16a34a,color:#111827;
    classDef warning fill:#fef9c3,stroke:#ca8a04,color:#111827;
    classDef blocked fill:#fee2e2,stroke:#dc2626,color:#111827;

    class A user;
    class B,O,ZD frontend;
    class F,G,S,T ai;
    class H,I,J,K,U,V,W,Y backend;
    class L,M,Z,ZA cre;
    class N,N2,ZB,ZC,ZE,CR,CP,AG chain;
    class ZG success;
    class Q warning;
    class ZH blocked;
```

---

## Chainlink Integration

### Chainlink Confidential AI Attester

Compliance documents are evaluated inside a **Trusted Execution Environment (TEE)** using Gemma4. The document never leaves the enclave. The model returns a structured JSON verdict — `approved`, `confidence`, `reasonCode`, `summary` — delivered asynchronously to our backend via webhook.

Key design decisions:
- `verificationId` embedded in the callback URL — resolves the exact session even with concurrent verifications
- AI output never goes onchain — only a `keccak256` attestation hash is written as the onchain fingerprint
- Replay protection — `verificationIdHash` permanently stored in ClaimRegistry; duplicate submissions revert

### Chainlink CRE

CRE is the **sole authorized writer** to our smart contracts. It holds `CRE_UPDATER_ROLE` — the only key allowed to call `ClaimRegistry.submitClaim` and `CompliancePassport.syncPassport`.

CRE workflow per verification:
1. Receive `verificationId` from backend
2. `GET /cre/verification-result/:verificationId` — fetch sanitized result
3. Validate payload
4. `keccak256(verificationId)` → `verificationIdHash`
5. `ClaimRegistry.submitClaim(...)` — write claim onchain
6. `CompliancePassport.syncPassport(...)` — mint or update soulbound passport
7. `AccessGate.getAccessSummary(...)` — read access decision
8. `POST /cre/workflow-result` — return tx hashes to backend

---

## Smart Contracts

| Contract | Type | Role |
|---|---|---|
| `ClaimRegistry.sol` | AccessControl | Stores verified claims per wallet. Only CRE can write. |
| `CompliancePassport.sol` | ERC-721 + ERC-5192 | Soulbound passport. Minted on first claim. Status derived from ClaimRegistry. |
| `AccessGate.sol` | Read-only | Reads ClaimRegistry + CompliancePassport. Answers `canAccessDealRoom`, `canAccessInvestorArea`. |

Claims: `KYC_AML_VERIFIED` · `ACCREDITED_INVESTOR`

Passport status: `NONE → IN_PROGRESS → LIMITED → GREEN` (or `RED` on KYC failure, `REVOKED` by admin)

---

## Repo Structure

```
apps/
  api/       — NestJS backend (Prisma + PostgreSQL)
  web/       — Next.js 14 frontend (TailwindCSS + Privy)
contracts/   — Foundry smart contracts (Solidity)
cre/         — Chainlink CRE workflow (TypeScript + viem)
demo/        — Synthetic compliance documents + AI prompts
docs/        — Architecture, AI usage, judges notes
```

---

## Privacy Rules

- No PII stored onchain — only `keccak256` hashes
- No raw documents stored anywhere — forwarded to Chainlink TEE only, then discarded
- Backend exposes sanitized verdict to CRE only — no raw AI output, no documents
- `verificationIdHash` replay protection on every claim submission

---

## How to Test the Demo

**No local setup needed — everything runs on Railway and Vercel.**

1. Open https://passport-creds-node-web.vercel.app/
2. Connect with Privy Embedded Wallet (email or social login — no browser extension needed)
3. On the Passport page, click **Download Sample Document** before uploading — the app requires it
4. Upload the downloaded file and click **Submit for Verification**
5. The Chainlink Confidential AI Attester evaluates the document and delivers the result via webhook
6. If the live Attester is unavailable, click **⚡ Demo: Simulate Verified** to run the full pipeline with a saved sample result
7. Repeat for the Accredited Investor claim to reach passport status **GREEN** and unlock the Deal Room

### About the prompts and sample documents

The AI Attester is instructed via structured system prompts located in `demo/`:

| File | Purpose |
|---|---|
| `demo/prompt-kyc-aml.txt` | Instructs Gemma4 to evaluate KYC/AML evidence and return structured JSON |
| `demo/prompt-accredited-investor.txt` | Instructs Gemma4 to evaluate Accredited Investor evidence and return structured JSON |

The prompts ask the model to return a minified JSON verdict only — `claimType`, `approved`, `confidence`, `reasonCode`, `summary`. No prose, no explanation. This keeps the output deterministic and parseable by the backend.

The sample documents available for download in the app (`public/samples/`) are intentionally simple synthetic files. The goal is not to test document quality — it is to demonstrate the full pipeline: document → TEE evaluation → webhook → CRE → onchain claim → passport → access decision.

---

## Quick Start (local)

```bash
# Start everything
make up

# Run E2E demo
make test-green
```

---

## Documentation

| Doc | Description |
|---|---|
| [Architecture](docs/architecture.md) | Actors, stack, data flow, design decisions |
| [AI Usage](docs/ai-usage.md) | How AI is used in the product and in development |
| [Judges](docs/judges.md) | Prize tracks, proof of work, full flow diagram |
