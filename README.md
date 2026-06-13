# PassportCreds by Node

White-label Compliance Passport for regulated access.

Built for ETHGlobal using Chainlink Confidential AI Attester and Chainlink CRE.

## Demo flow

```
User connects MetaMask
→ starts compliance verification
→ Chainlink Confidential AI Attester evaluates synthetic evidence
→ AI Attester sends structured result to backend via ngrok webhook
→ backend stores sanitized result
→ backend triggers Chainlink CRE with verificationId only
→ CRE fetches sanitized result from backend
→ CRE updates ClaimRegistry and CompliancePassport onchain
→ frontend shows KYC/AML badge, Accredited Investor badge, passport status, tx hashes
→ AccessGate unlocks the Node PropTech Deal Room
```

## Repo structure

```
apps/
  api/     — NestJS backend (Prisma + PostgreSQL)
  web/     — Next.js 14 frontend (TailwindCSS)

contracts/ — Foundry smart contracts
  src/
    ClaimRegistry.sol
    CompliancePassport.sol   (ERC721 + ERC5192 soulbound)
    AccessGate.sol

cre/       — CRE simulation script (TypeScript)
```

## Getting started

### 1. Contracts

```bash
cd contracts
forge install
forge test
forge script script/DeployPassportCreds.s.sol --rpc-url $RPC_URL --broadcast
```

### 2. Backend

```bash
cd apps/api
cp .env.example .env
npm install
npx prisma migrate dev
npm run start:dev
```

### 3. Frontend

```bash
cd apps/web
cp .env.example .env.local
npm install
npm run dev
```

### 4. CRE simulation

```bash
cd cre
cp .env.example .env
npm install
npm run simulate:cre -- --verificationId ver_123
```

### 5. ngrok (expose backend for AI Attester webhook)

```bash
ngrok http 3000
# copy the public URL → set in AI Attester Playground as webhook destination
```

## Claims supported

```
KYC_AML_VERIFIED
ACCREDITED_INVESTOR
```

## Passport status model

| Status | Meaning |
|--------|---------|
| NONE | No verified claims |
| IN_PROGRESS | Verification pending |
| LIMITED | KYC/AML verified, Accredited Investor missing |
| GREEN | Both claims verified — full access |
| RED | KYC/AML failed — access blocked |
| REVOKED | Passport revoked by admin |
| EXPIRED | Claims expired |

## Privacy rules

- No PII stored onchain
- No raw documents stored anywhere
- Only attestation hashes and claim status go onchain
- Backend exposes sanitized data only to CRE
