# PassportCreds by Node

**White-label Compliance Passport for regulated onchain access.**

Built for ETHGlobal using Chainlink Confidential AI Attester and Chainlink CRE.

A wallet connects, uploads compliance evidence, Chainlink evaluates it inside a TEE, and a soulbound Compliance Passport is minted onchain. The Deal Room unlocks. No PII ever touches a smart contract.

---

## Chainlink Integration

### Chainlink Confidential AI Attester

We use the Chainlink Confidential AI Attester to evaluate compliance documents (KYC/AML and Accredited Investor evidence) inside a **Trusted Execution Environment (TEE)**. The document never leaves the enclave. The model (Gemma4) produces a structured JSON verdict — `approved`, `confidence`, `reasonCode`, `summary` — and delivers it asynchronously to our backend via a `cre_callback` webhook.

Key design decisions:
- The `verificationId` is embedded in the callback URL (`?verificationId=<id>`) so the webhook resolves the exact session without ambiguity — even if two verifications for the same wallet are in flight simultaneously
- The AI output never goes onchain. Only a `keccak256` attestation hash is written — the onchain fingerprint of the verdict, not the verdict itself
- The Accredited Investor flow classifies evidence for demo purposes only — not legal verification

**API call:**
```
POST https://confidential-ai-dev-preview.cldev.cloud/v1/inference
{
  model: "gemma4",
  system_prompt: "Return ONLY a minified JSON object...",
  prompt: "<compliance evaluation prompt>",
  resources: [{ filename, content_type, content_base64 }],
  cre_callback: { url: "https://<ngrok>/webhooks/ai-attester?verificationId=<id>" }
}
```

**Webhook envelope format** (what Chainlink delivers):
```json
{
  "input": {
    "inferenceId": "f8c3de3d-...",
    "output": "{\"claimType\":\"KYC_AML_VERIFIED\",\"approved\":true,\"confidence\":0.97,...}",
    "cre_callback": { "url": "...", "executed": false }
  }
}
```

---

### Chainlink CRE (Compute and Runtime Environment)

We use CRE as a **custom offchain compute workflow** — the only authorized writer to our smart contracts. The backend sends CRE a single `verificationId`. CRE fetches the sanitized verdict from the backend, validates it, hashes identifiers, and writes two onchain transactions.

CRE holds `CRE_UPDATER_ROLE` — the only key allowed to call `ClaimRegistry.submitClaim` and `CompliancePassport.syncPassport`. No other actor (frontend, backend, user) can write compliance state onchain.

**CRE workflow per verification:**
1. `GET /cre/verification-result/:verificationId` — fetch sanitized result from backend
2. Validate: claimType, approved, attestationHash, walletAddress
3. `keccak256(verificationId)` → `verificationIdHash` for replay protection
4. `ClaimRegistry.submitClaim(...)` — write claim onchain (EVM tx)
5. `CompliancePassport.syncPassport(...)` — mint or update soulbound passport (EVM tx)
6. `AccessGate.getAccessSummary(...)` — read access decision (no gas)
7. `POST /cre/workflow-result` — send tx hashes back to backend

**Replay protection:** The contract permanently stores `verificationIdHash` and reverts any duplicate submission — the same verification result can never be written onchain twice.

---

## Demo flow

```
User connects MetaMask
→ uploads KYC/AML document
→ backend creates VerificationSession (verificationId generated)
→ backend calls Chainlink Confidential AI Attester with document + callback URL
→ Chainlink TEE evaluates document (Gemma4)
→ AI Attester POSTs verdict to /webhooks/ai-attester?verificationId=<id>
→ backend resolves session by verificationId, stores sanitized result
→ backend triggers CRE: POST /trigger { verificationId }
→ CRE fetches sanitized result, validates, writes ClaimRegistry onchain
→ CRE calls CompliancePassport.syncPassport → SBT minted, status = LIMITED
→ frontend shows KYC/AML badge GREEN, Deal Room unlocked

→ user uploads Accredited Investor document
→ same pipeline runs for ACCREDITED_INVESTOR claim
→ CompliancePassport status updated to GREEN
→ full investor access unlocked
```

---

## Smart contracts

| Contract | Type | Role |
|---|---|---|
| `ClaimRegistry.sol` | AccessControl | Stores verified claims per wallet. Only CRE can write. |
| `CompliancePassport.sol` | ERC721 + ERC5192 | Soulbound passport. Minted on first claim. Status derived from ClaimRegistry. |
| `AccessGate.sol` | Read-only | Stateless. Reads ClaimRegistry + CompliancePassport to answer `canAccessDealRoom`, `canAccessInvestorArea`. |

Claims supported: `KYC_AML_VERIFIED`, `ACCREDITED_INVESTOR`

Passport status model: `NONE → IN_PROGRESS → LIMITED → GREEN` (or `RED` on KYC failure)

---

## Repo structure

```
apps/
  api/       — NestJS backend (Prisma + PostgreSQL)
  web/       — Next.js 14 frontend (TailwindCSS)
contracts/   — Foundry smart contracts
cre/         — Chainlink CRE workflow (TypeScript + viem)
demo/        — Synthetic compliance documents + AI prompts
docs/        — Full protocol documentation
```

---

## Quick start

```bash
# Start everything
make up

# Expose webhook for Chainlink AI Attester
make ngrok
# copy the ngrok URL → set NGROK_PUBLIC_URL in apps/api/.env

# Run E2E demo test
make test-green
```

---

## Privacy rules

- No PII stored onchain — only `keccak256` hashes
- No raw documents stored anywhere — forwarded to Chainlink TEE only
- Backend exposes sanitized verdict to CRE only — no raw AI output
- `verificationIdHash` replay protection on every claim submission

---

## Documentation

| Doc | Description |
|---|---|
| [Protocol explanation](../docs/12-protocol-explanation.md) | Full end-to-end flow, Chainlink roles, verificationId mechanics |
| [Contract call flow](../docs/13-contract-call-flow.md) | Every contract function call in order with state changes |
| [AI Attester + ngrok](../docs/04-ai-attester-and-ngrok.md) | Chainlink Confidential AI Attester integration details |
| [CRE architecture](../docs/06-cre-architecture.md) | CRE workflow design |
| [Smart contracts](../docs/05-smart-contracts-architecture.md) | Contract architecture |
| [Database schema](../docs/03a-database-schema.md) | Prisma schema and field docs |
| [Demo script](../docs/07-demo-script.md) | Step-by-step demo walkthrough |
