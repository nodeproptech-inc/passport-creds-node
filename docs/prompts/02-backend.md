# Prompts — Backend (`apps/api`, NestJS)

> Reference: `FORK-BOOTSTRAP.md` (backend keep/change), `specs/reuse-inventory.md`, `specs/onchainid-spec.md §3`.
> Reuse the NestJS scaffolding; the delta is the **issuer signing service** + repointing reads to the gate.

## Issuer signing service (evolve `attester/`)
```
Prompt: "In apps/api, evolve the existing `attester` module into an ISSUER SIGNING SERVICE:
an authorized signer that produces EIP-712 signatures for the ClaimIssuer contract
(typehash: Claim(address identity,uint256 topic,bytes32 dataHash,uint64 expiresAt,bytes32 nonce)).
Two sources, both LABELED: (a) World proof → PROOF_OF_PERSONHOOD claim; (b) mock evidence
(KYC/accredited, clearly MOCK) → claim. Nonce handling. Do NOT store PII — only a dataHash.
Keep prisma models; add a Claim/Attestation record if useful."
```

## World proof receiver (adapt `webhooks/`)
```
Prompt: "Repurpose the webhooks/verification modules: receive + validate a World proof,
then call the issuer signing service to sign a PROOF_OF_PERSONHOOD claim. Return the signed
payload so the FRONTEND (the holder) submits it on-chain (Model B). No on-chain writing here."
```

## Read APIs (adapt `passport/`, `access/`)
```
Prompt: "Repoint the passport + access controllers to read from the on-chain EligibilityGate
(isEligible(identity, policyId)) via viem, instead of the old ClaimRegistry. Return dashboard
state: status GREEN/RED, per-claim status, identity address, ENS name."
```

## Subname issuance trigger
```
Prompt: "Add an endpoint/service that, on onboarding, calls PassportSubnameRegistrar.issueSubname
(via the tenant-approved backend wallet) to mint the user's <label>.passportkit.eth pointing at
the PassportResolver, then registers node→identity. No PII."
```

## Revocation trigger (demo)
```
Prompt: "Add a revoke endpoint that calls ClaimIssuer.revoke / Identity.revokeClaim for a
given wallet+topic — this is the demo 'money moment' trigger. Log the decision."
```

## Remove
- Delete `cre/` and `wallets/wallet-policy*` (superseded — done in bootstrap Step 3).
