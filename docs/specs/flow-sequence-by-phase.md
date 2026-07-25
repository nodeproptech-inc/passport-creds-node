# Flow — sequence diagrams, one per phase

> Paste into HackMD. Each phase is its own small diagram (easier to read). Solid = call, dashed = return.
> The whole system in one line: **every surface reads the same `EligibilityGate.isEligible`** → one `revokeClaim` flips all of them.

## Phase 1 — Onboarding
```mermaid
sequenceDiagram
    autonumber
    actor U as User (Privy)
    participant FE as Frontend
    participant BE as Backend
    participant IF as IdentityFactory
    participant ID as Identity (OnchainID)
    U->>FE: login (Privy embedded wallet)
    FE->>BE: POST /wallets/setup (wallet)
    BE->>IF: createIdentity(wallet)
    IF->>ID: deploy Identity(wallet, issuerRegistry)
    IF-->>BE: identity address
    BE-->>FE: { identity }
    FE-->>U: onboarded
```

## Phase 2 — Verify + claim (World + Model B)
```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant FE as Frontend
    participant W as World (attester)
    participant BE as Backend / Issuer signer
    participant ID as Identity
    participant IR as IssuerRegistry
    participant CI as ClaimIssuer
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
    CI-->>ID: true (signer recovered)
    ID-->>U: claimId stored
```

## Phase 3 — ENS subname (by code)
```mermaid
sequenceDiagram
    autonumber
    participant BE as Backend
    participant REG as SubnameRegistrar
    participant NW as ENS NameWrapper
    participant RES as PassportResolver
    BE->>REG: issueSubname(parentNode, label, wallet, identity)
    REG->>NW: setSubnodeRecord(parent, label, owner, resolver=RES)
    NW-->>REG: node
    REG->>RES: setIdentity(node, parentNode, identity)
    RES-->>REG: ok
    REG-->>BE: node (alice.tenant.eth ready)
```

## Phase 4 — Access reads (GREEN) — all call the same isEligible
```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant FE as Frontend / GatedApp
    participant RES as PassportResolver
    participant EG as EligibilityGate
    participant IR as IssuerRegistry
    participant ID as Identity
    participant CI as ClaimIssuer
    participant TOK as GatedERC20
    participant HK as ComplianceHook
    Note over FE,CI: read via ENS — gate re-checks the issuer
    FE->>RES: getEnsText(name, "compliance.status")
    RES->>EG: isEligible(identity, policyId)
    EG->>IR: issuersForTopic(topic)
    IR-->>EG: [issuers]
    EG->>ID: getClaim(topic, issuer)
    ID-->>EG: (exists, sig, data)
    EG->>CI: isClaimValid(identity, topic, sig, data)
    CI-->>EG: true (not revoked, signer ok)
    EG-->>RES: (true, OK)
    RES-->>FE: "GREEN" → app opens
    Note over U,HK: other surfaces — same isEligible
    U->>TOK: transfer(to, amt)
    TOK->>EG: isEligible(id of from & to, policy)
    EG-->>TOK: (true, OK)
    TOK-->>U: transfer ok
    U->>HK: swap
    HK->>EG: isEligible(identity, policy)
    EG-->>HK: (true, OK)
    HK-->>U: swap ok
```

## Phase 5 — Money moment (revoke flips everything)
```mermaid
sequenceDiagram
    autonumber
    actor U as User
    actor A as Admin / Issuer
    participant CI as ClaimIssuer
    participant FE as Frontend / GatedApp
    participant RES as PassportResolver
    participant EG as EligibilityGate
    participant TOK as GatedERC20
    participant HK as ComplianceHook
    A->>CI: setRevoked(identity, topic, true) [per-user latch]
    CI-->>A: revoked
    Note over RES,EG: no ENS tx, no keeper (read-through)
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
```
