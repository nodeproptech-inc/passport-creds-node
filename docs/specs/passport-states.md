# Passport — state diagram

> Paste into HackMD. The passport status shown on the dashboard. Transitions are labeled by the event.
> Note: "status" is a UI summary; on-chain the truth is `EligibilityGate.isEligible(identity, policyId)` **per policy**.

```mermaid
stateDiagram-v2
    [*] --> NONE: identity created, no claims
    NONE --> IN_PROGRESS: start verification
    IN_PROGRESS --> LIMITED: KYC claim lands
    IN_PROGRESS --> GREEN: all required claims land
    IN_PROGRESS --> RED: critical claim rejected
    LIMITED --> GREEN: remaining claim lands
    GREEN --> LIMITED: non-critical claim revoked or expired
    GREEN --> REVOKED: revoke KYC — money moment
    LIMITED --> REVOKED: revoke KYC
    GREEN --> EXPIRED: claim expired
    LIMITED --> EXPIRED: claim expired
    REVOKED --> IN_PROGRESS: re-verify (issuer re-opens latch, then re-signs)
    EXPIRED --> IN_PROGRESS: re-verify
    RED --> IN_PROGRESS: re-verify

    note right of GREEN
      isEligible = true
      transfer / swap / gated open · ENS = GREEN
    end note
    note right of REVOKED
      isEligible = false · reason MISSING_KYC
      all surfaces refuse · ENS = REVOKED
      latch held by issuer: no new claim
      can land until issuer setRevoked(false)
    end note
```

## What each state means
| State | Meaning | Gate result |
|---|---|---|
| **NONE** | no identity or no valid claims | not eligible (NO_IDENTITY / missing) |
| **IN_PROGRESS** | proof done, claim being submitted (FE/BE state) | not eligible yet |
| **LIMITED** | KYC valid, but not the stricter claims (e.g. no accredited) | ✅ base policy · ❌ investor policy |
| **GREEN** | all required claims valid | ✅ passes the strictest policy |
| **RED** | a critical claim rejected | not eligible |
| **REVOKED** | a required claim revoked | not eligible (MISSING_*) |
| **EXPIRED** | a required claim past `expiresAt` | not eligible |

## Key point (per-policy, not one global status)
- **LIMITED vs GREEN** is just *which policy* you pass: KYC-only opens the Deal Room (policy #1); KYC + accredited opens investor actions.
- The ENS `compliance.status` record simplifies to **GREEN / REVOKED / NONE** for the demo, but the dashboard can show the full set.
- Every transition into a non-eligible state (REVOKED / EXPIRED / RED) is what makes **the four surfaces refuse** — the demo.
