# PassportCreds — presentation diagrams

Copy-paste blocks for slides, HackMD, or the submission page. Grey = shipped at the
previous ETHGlobal, blue/teal = built for Lisbon 2026.

---

## 1. Continuity map — what existed, what we added

> One line for the pitch: *the compliance core is untouched; everything new is a
> surface that asks it the same question.*

```mermaid
flowchart TD
    subgraph OFFCHAIN["Evidence pipeline · off-chain"]
        ATT["Chainlink AI Attester<br/>TEE reads the document"]
        API["apps/api<br/>NestJS + Postgres"]
        CRE["cre/<br/>Chainlink CRE · sole writer"]
        WEB["apps/web<br/>Next.js + Privy wallet"]
    end

    subgraph CORE["Compliance core · Base Sepolia · UNCHANGED"]
        REG["ClaimRegistry<br/>claims + expiry"]
        PASS["CompliancePassport<br/>soulbound ERC-721"]
        GATE["AccessGate<br/>canAccessDealRoom"]
    end

    subgraph S4["Surface 4 · compliant markets · NEW"]
        HOOK["ComplianceHook<br/>gates swap + add liquidity"]
        ROUTER["DemoPositionRouter<br/>caller-bound positions"]
        HDEMO["apps/hook-demo<br/>runnable demo"]
    end

    subgraph S5["Surface 5 · house concierge · NEW"]
        TREAS["HouseTreasury<br/>mandate + m-of-n queue"]
        CASA["HouseToken · CASA<br/>agent budget"]
        MHOOK["MandateHook<br/>gates the budget pool"]
        AGENT["apps/concierge<br/>agent runtime + x402"]
    end

    WEB --> ATT --> API --> CRE
    CRE -->|"writes claims"| REG
    CRE -->|"syncs passport"| PASS
    REG --> GATE
    PASS --> GATE

    GATE -->|"is this wallet allowed?"| HOOK
    GATE -->|"are the owners still compliant?"| TREAS
    HOOK --- ROUTER
    HOOK --- HDEMO
    TREAS --> MHOOK
    TREAS --> CASA
    TREAS --- AGENT
    MHOOK --- AGENT

    classDef old fill:#EDF0F5,stroke:#6B7A93,color:#0D1428
    classDef core fill:#E7ECF4,stroke:#0D1428,stroke-width:2px,color:#0D1428
    classDef new fill:#E3F0FE,stroke:#2C7FE8,color:#0D1428
    classDef agent fill:#DEF7F6,stroke:#17A8A6,color:#0D1428

    class ATT,API,CRE,WEB old
    class REG,PASS,GATE core
    class HOOK,ROUTER,HDEMO new
    class TREAS,CASA,MHOOK,AGENT agent
```

---

## 2. The thesis — an agent's authority is borrowed from humans

> Agents can't KYC. So the concierge holds no passport: it holds a *mandate*, and the
> mandate is only alive while every owner's passport is.

```mermaid
flowchart LR
    OWN1["Owner · Ana<br/>passport GREEN"]
    OWN2["Owner · Operator<br/>passport GREEN"]
    GATE["AccessGate"]
    STAND["HouseTreasury<br/>isAgentInGoodStanding"]
    AGENT["Concierge agent<br/>no passport of its own"]
    POOL["MandateHook<br/>budget pool"]
    QUEUE["Approval queue<br/>treasury payments"]

    OWN1 --> GATE
    OWN2 --> GATE
    GATE -->|"every owner checked live"| STAND
    MAND["Mandate<br/>cap · expiry · revocable"] --> STAND
    STAND -->|"ok / reason code"| AGENT
    AGENT --> POOL
    AGENT --> QUEUE

    classDef human fill:#E3F0FE,stroke:#2C7FE8,color:#0D1428
    classDef core fill:#E7ECF4,stroke:#0D1428,stroke-width:2px,color:#0D1428
    classDef agent fill:#DEF7F6,stroke:#17A8A6,color:#0D1428

    class OWN1,OWN2 human
    class GATE core
    class STAND,MAND,AGENT,POOL,QUEUE agent
```

---

## 3. Two spending rails

> Small things happen by themselves. Big things wait for humans. The boundary is
> enforced on-chain, not in the agent's code.

```mermaid
sequenceDiagram
    autonumber
    participant T as Ticket
    participant A as Concierge agent
    participant H as MandateHook pool
    participant V as Vendor · x402
    participant TR as HouseTreasury
    participant O as Owners

    T->>A: leaky faucet, 120 mUSD
    A->>A: decide · hash the decision

    alt within cap and budget
        A->>H: swap CASA for 120 mUSD
        H->>TR: agent in good standing? within per-tx cap?
        TR-->>H: yes
        H-->>A: filled
        A->>V: POST invoice
        V-->>A: 402 payment required
        A->>V: pay + retry with proof
        V-->>A: paid
    else above cap or budget
        A->>TR: proposePayment with evidence hash
        TR-->>O: pending approval
        O->>TR: approve · operator
        O->>TR: approve · ana
        TR->>V: threshold met, treasury pays
    end
```

---

## 4. The kill switch — one revoke, both rails

> The demo moment. Nothing about the agent changes: its wallet, mandate and budget are
> untouched. A *human's* passport lapses and the agent loses its hands.

```mermaid
sequenceDiagram
    autonumber
    participant I as Issuer
    participant R as ClaimRegistry
    participant G as AccessGate
    participant A as Concierge agent
    participant H as MandateHook pool
    participant TR as HouseTreasury

    I->>R: revoke Ana's KYC claim
    Note over R,G: no other contract is touched

    A->>H: swap CASA for mUSD
    H->>TR: standing?
    TR->>G: is every owner compliant?
    G-->>TR: Ana is not
    TR-->>H: no · OWNER_NOT_COMPLIANT
    H-->>A: revert NotAuthorized

    A->>TR: proposePayment
    TR->>G: is every owner compliant?
    G-->>TR: Ana is not
    TR-->>A: revert NotAgent

    Note over A: both rails dead in the same block
```

---

## 5. Why a wallet is refused — the reason codes

> Every refusal names itself, so the UI and the judges can see *which* rule bit.

```mermaid
flowchart TD
    START["Agent tries to act"] --> M{"Mandate exists<br/>for this wallet?"}
    M -- no --> R1["NO_MANDATE"]
    M -- yes --> M2{"Revoked?"}
    M2 -- yes --> R2["MANDATE_REVOKED"]
    M2 -- no --> M3{"Expired?"}
    M3 -- yes --> R3["MANDATE_EXPIRED"]
    M3 -- no --> M4{"Every owner still<br/>passes AccessGate?"}
    M4 -- no --> R4["OWNER_NOT_COMPLIANT"]
    M4 -- yes --> M5{"Swap within<br/>per-tx cap?"}
    M5 -- no --> R5["OVER_PER_TX_CAP"]
    M5 -- yes --> OK["Allowed"]

    classDef bad fill:#FEE2E2,stroke:#DC2626,color:#0D1428
    classDef good fill:#DCFCE7,stroke:#16A34A,color:#0D1428
    classDef step fill:#E3F0FE,stroke:#2C7FE8,color:#0D1428

    class R1,R2,R3,R4,R5 bad
    class OK good
    class START,M,M2,M3,M4,M5 step
```

---

## 6. Passport and mandate lifecycles

> Both are live state, not a snapshot: claims expire on their own, and the passport
> that gates the pool is the same one that gates the Deal Room.

```mermaid
stateDiagram-v2
    direction LR
    state "Passport" as P {
        [*] --> NONE
        NONE --> LIMITED: KYC verified
        LIMITED --> GREEN: accreditation verified
        GREEN --> LIMITED: accreditation expires
        LIMITED --> RED: KYC failed or revoked
        LIMITED --> REVOKED: issuer revokes
        GREEN --> REVOKED: issuer revokes
    }
    state "Agent mandate" as M {
        [*] --> Granted: owner grants cap + expiry
        Granted --> Revoked: any owner revokes
        Granted --> Expired: horizon passes
        Revoked --> Granted: re-granted
    }
```

---

## 7. Demo run sheet — two minutes

```mermaid
flowchart LR
    A["1 · Leaky faucet<br/>120 mUSD"] --> B["agent pays alone<br/>swap + x402"]
    B --> C["2 · Roof repair<br/>4500 mUSD"]
    C --> D["queued · 2 owners approve<br/>treasury pays"]
    D --> E["3 · Revoke Ana's KYC"]
    E --> F["both rails refuse<br/>OWNER_NOT_COMPLIANT"]
    F --> G["4 · Restore<br/>everything works again"]

    classDef step fill:#E3F0FE,stroke:#2C7FE8,color:#0D1428
    classDef out fill:#DEF7F6,stroke:#17A8A6,color:#0D1428
    classDef bad fill:#FEE2E2,stroke:#DC2626,color:#0D1428

    class A,C,E,G step
    class B,D out
    class F bad
```
