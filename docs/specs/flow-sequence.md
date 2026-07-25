# Flow — sequence diagram (every call, round-trips)

> Paste into HackMD. Solid arrow = call, dashed = return. 5 phases. The point: **all surfaces read the same `isEligible`**, so one `revokeClaim` flips everything.

```mermaid
sequenceDiagram
    autonumber
    actor U as User (Privy wallet)
    participant FE as Frontend
    participant BE as Backend / Issuer signer
    participant W as World (attester)
    participant IF as IdentityFactory
    participant ID as Identity (OnchainID)
    participant CI as ClaimIssuer
    participant IR as IssuerRegistry
    participant EG as EligibilityGate
    participant REG as SubnameRegistrar
    participant NW as ENS NameWrapper
    participant RES as PassportResolver
    participant TOK as GatedERC20
    participant HK as ComplianceHook

    rect rgb(235,245,255)
    Note over U,ID: 1) Onboarding
    U->>FE: login (Privy embedded wallet)
    FE->>BE: POST /wallets/setup (wallet)
    BE->>IF: createIdentity(wallet)
    IF->>ID: deploy Identity(wallet, issuerRegistry)
    IF-->>BE: identity address
    BE-->>FE: { identity }
    end

    rect rgb(235,255,235)
    Note over U,ID: 2) Verify + claim (World + Model B)
    U->>FE: start KYC / personhood
    FE->>W: World proof flow
    W-->>FE: proof
    FE->>BE: submit proof
    BE->>W: verify proof
    W-->>BE: valid
    Note over BE: sign EIP-712 claim<br/>(identity, topic, dataHash, expiresAt, nonce)
    BE-->>FE: { signature, data, topic }
    Note over U,ID: HOLDER submits (Model B)
    U->>ID: submitClaim(topic, issuer, sig, data)
    ID->>IR: isTrusted(issuer, topic)
    IR-->>ID: true
    ID->>CI: isClaimValid(identity, topic, sig, data)
    CI-->>ID: true (ecrecover == signer)
    ID-->>U: claimId (stored)
    end

    rect rgb(255,250,235)
    Note over BE,RES: 3) ENS subname (by code)
    BE->>REG: issueSubname(parentNode, label, wallet, identity)
    REG->>NW: setSubnodeRecord(parent, label, owner, RES)
    NW-->>REG: node
    REG->>RES: setIdentity(node, parentNode, identity)
    RES-->>REG: ok
    end

    rect rgb(245,240,255)
    Note over FE,HK: 4) Access reads — ALL call the SAME isEligible
    FE->>RES: getEnsText(name, "compliance.status")
    RES->>EG: isEligible(identity, policyId)
    EG->>IR: issuersForTopic(topic)
    IR-->>EG: [issuers]
    EG->>ID: getClaim(topic, issuer)
    ID-->>EG: (exists, sig, data)
    EG->>CI: isClaimValid(identity, topic, sig, data)
    CI-->>EG: true (not revoked, signer ok)
    EG-->>RES: (true, OK)
    RES-->>FE: "GREEN"  → gated app opens
    U->>TOK: transfer(to, amt)
    TOK->>EG: isEligible(identity(from & to), policy)
    EG-->>TOK: (true, OK)
    TOK-->>U: transfer ok
    U->>HK: swap (via pool)
    HK->>EG: isEligible(identity, policy)
    EG-->>HK: (true, OK)
    HK-->>U: swap ok
    end

    rect rgb(255,235,235)
    Note over U,HK: 5) MONEY MOMENT — one revoke flips everything
    U->>CI: setRevoked(identity, topic, true) [admin/issuer · per-user latch]
    CI-->>U: revoked
    Note over EG,RES: no ENS tx, no keeper (read-through)
    FE->>RES: getEnsText(... "compliance.status")
    RES->>EG: isEligible(identity, policy)
    EG->>CI: isClaimValid(...)
    CI-->>EG: false (revoked)
    EG-->>RES: (false, MISSING_KYC)
    RES-->>FE: "REVOKED" (auto-flip)
    U->>TOK: transfer(...)
    TOK->>EG: isEligible(...)
    EG-->>TOK: (false, MISSING_KYC)
    TOK-->>U: revert NotEligible
    U->>HK: swap
    HK->>EG: isEligible(...)
    EG-->>HK: (false)
    HK-->>U: revert NotCompliant
    end
```

## Relationships (who calls whom)
- **Identity** = source of truth (claims). Written only by the holder (Model B); read by the gate.
- **ClaimIssuer** = signs claims; verified at write via `isClaimValid` (trust = signature).
- **IssuerRegistry** = trusted issuers per topic → **bounds the gate's loop** (griefing-proof).
- **EligibilityGate** = the single read. Called by **PassportResolver, GatedERC20, ComplianceHook, and the gated app**. It calls IssuerRegistry, reads the claim off Identity, and **re-verifies with the ClaimIssuer**.
- **PassportResolver** = read-through: `text()` → `isEligible` live → ENS reflects state with **zero writes**.
- **Revocation** lives on the **ClaimIssuer** as a **latch** — per-user (`setRevoked(identity, topic, true)`) or global (de-trust issuer / de-authorize signer), re-verified at read. While latched, no fresh claim for that topic can land; re-verification is issuer-gated (`setRevoked(...,false)`). The holder owns their identity but not claim validity. ENS never holds independent state → no drift.

## The one idea
Every surface points at `EligibilityGate.isEligible`. Change the claim once → every surface changes. **The demo is the refusal.**
