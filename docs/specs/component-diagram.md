# Components — static relationships (who calls whom)

> Paste into HackMD. Complements the sequence diagrams. **The `EligibilityGate` is the hub** — every surface reads it; it reads `IssuerRegistry` + `Identity` and re-verifies with the `ClaimIssuer`.

```mermaid
flowchart TB
    subgraph OFF[Off-chain]
      U[User / Privy wallet]
      FE[Frontend / Gated App]
      BE[Backend / Issuer signer]
      W[World attester]
    end
    subgraph CORE[Identity core - on-chain]
      IF[IdentityFactory]
      ID[Identity OnchainID<br/>claims = source of truth]
      CI[ClaimIssuer EIP-712]
      IR[IssuerRegistry]
      EG{{EligibilityGate<br/>isEligible then bool, reason}}
    end
    subgraph SURF[Surfaces - all read the gate]
      TOK[GatedERC20]
      HK[ComplianceHook v4]
      GAPP[Gated App / Deal Room]
    end
    subgraph ENSG[ENS]
      REG[SubnameRegistrar]
      NW[NameWrapper]
      RES[PassportResolver<br/>read-through]
    end

    U --> FE --> BE
    BE -->|createIdentity| IF
    BE -->|sign EIP-712| CI
    W -. proof .-> BE
    BE -->|issueSubname| REG

    IF -->|deploys / identityOfWallet| ID
    ID -->|checks on submitClaim| IR
    ID -->|checks on submitClaim| CI

    EG -->|issuersForTopic| IR
    EG -->|getClaim| ID
    EG -->|isClaimValid re-check| CI

    TOK -->|isEligible| EG
    HK -->|isEligible| EG
    GAPP -->|isEligible| EG
    RES -->|isEligible read-through| EG

    TOK -. identityOfWallet .-> IF
    HK -. identityOfWallet .-> IF

    REG -->|setSubnodeRecord| NW
    REG -->|setIdentity| RES
    FE -->|getEnsText| RES

    classDef hub fill:#fde68a,stroke:#b45309,stroke-width:3px,color:#3b2f00;
    classDef truth fill:#dcfce7,stroke:#16a34a,color:#14532d;
    classDef surf fill:#dbeafe,stroke:#2563eb,color:#1e3a8a;
    classDef off fill:#f1f5f9,stroke:#94a3b8,color:#334155;
    class EG hub;
    class ID truth;
    class TOK,HK,GAPP,RES surf;
    class U,FE,BE,W off;
```

## Legend
- **Solid arrow + label** = a call / relationship (who calls what).
- **Dashed** = a lookup (`identityOfWallet`) or off-chain proof.
- 🟡 **EligibilityGate** = the hub (single read point).
- 🟢 **Identity** = source of truth (claims container). **Revocation authority = ClaimIssuer** (per-user), re-checked at read.
- 🔵 **Surfaces** = GatedERC20, ComplianceHook, Gated App, PassportResolver — all read the gate.

## Read it in 4 sentences
1. **Backend** creates the identity, signs claims, and issues the ENS subname (by code).
2. **Identity** stores issuer-signed claims (Model B); on write it checks `IssuerRegistry` + `ClaimIssuer`.
3. **EligibilityGate** answers `isEligible` by looping trusted issuers, reading the claim off `Identity`, and **re-verifying with the `ClaimIssuer`** (revocation + signer).
4. **Every surface** (token, hook, gated app, ENS resolver) reads that one `isEligible` → one revoke flips all.
