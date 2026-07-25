# Spec — OnchainID & Claims Rail (PassportKit Node)

> Identity + claims layer. **New, minimal, public** build (IP-safe — no production code copied).
> Covers: **Identity** (ERC-734/735) · **IssuerRegistry** · **EligibilityGate**. The ComplianceHook has its own spec (`uniswap-hook-spec.md`).

---

## 0. Locked decisions

- **Model B — "no privileged writer" via self-owned key.** The user's wallet is the **MANAGEMENT key** of their own identity. The issuer only **signs** (EIP-712). The user submits the signed claim to their **own** identity. Nobody is a global writer; nobody writes to another's identity.
- **Trust = signature** (issuer), not who wrote it.
- **`claimId = keccak256(issuer, topic)`** → one slot per (issuer, topic); re-issuing updates in place.
- **Griefing closed at the source** by the keys; `MAX_CLAIMS_PER_TOPIC` as belt-and-suspenders.
- **O(1) read** per (topic, issuer) via nested mapping; eligibility loops required-topics × trusted-issuers (a small set we control).
- **Zero PII on-chain** — `data` holds a hash/reference only.

> ⚠️ **Align wording with Mehtab:** the brief says "anyone can submit". Model B is "the **holder** submits their own signed claim". More precise, keeps the rails thesis. If they require literal open-submit, see **Model C** in Security notes.

---

## 1. Keys (ERC-734)

```solidity
library KeyPurpose { uint256 constant MANAGEMENT = 1; uint256 constant ACTION = 2; uint256 constant CLAIM = 3; }
```
- MANAGEMENT satisfies any purpose.
- At mint: user wallet = MANAGEMENT (+ ACTION). **Issuer is NOT seeded as CLAIM** (Model B).
- `keyForAddress(a) = keccak256(abi.encode(a))`.

---

## 2. Claim model (ERC-735)

```solidity
struct Claim {
    uint256 topic;
    address issuer;      // trusted issuer contract
    bytes   signature;   // EIP-712 from the issuer's authorized signer
    bytes   data;        // hash/reference — NEVER PII
    uint64  expiresAt;   // 0 = no expiry
    bool    revoked;
    bool    exists;
}

// O(1) read: topic -> issuer -> claim
mapping(uint256 => mapping(address => Claim)) private _claim;
// eligibility-loop cap
mapping(uint256 => uint256) private _countByTopic;
uint256 constant MAX_CLAIMS_PER_TOPIC = 16;
```

Topics as `uint256(keccak256(name))`:
```solidity
KYC_VERIFIED         = uint256(keccak256("KYC_VERIFIED"));
PROOF_OF_PERSONHOOD  = uint256(keccak256("PROOF_OF_PERSONHOOD"));
ACCREDITED_INVESTOR  = uint256(keccak256("ACCREDITED_INVESTOR"));
```

---

## 3. `submitClaim` (Model B)

```solidity
function submitClaim(
    uint256 topic, address issuer, bytes calldata sig, bytes calldata data, uint64 expiresAt
) external returns (bytes32 claimId) {
    // (1) only the identity owner writes to their own identity (ERC-734 gate)
    require(keyHasPurpose(keyForAddress(msg.sender), KeyPurpose.CLAIM), "no claim key");
    // (2) issuer trusted for the topic
    require(issuerRegistry.isTrusted(issuer, topic), "untrusted issuer");
    // (3) valid issuer signature, bound to THIS identity (anti-replay)
    require(IClaimIssuer(issuer).isClaimValid(address(this), topic, sig, data), "bad signature");

    if (!_claim[topic][issuer].exists) {
        require(_countByTopic[topic] < MAX_CLAIMS_PER_TOPIC, "topic cap");
        _countByTopic[topic]++;
    }
    _claim[topic][issuer] = Claim(topic, issuer, sig, data, expiresAt, false, true);
    claimId = keccak256(abi.encode(issuer, topic));
    emit ClaimAdded(claimId, topic, issuer, expiresAt);
}
```

> Note: since the MANAGEMENT key satisfies any purpose, the user's own wallet passes (1). A relayer only works if granted an ACTION/CLAIM key or via an authorized meta-tx — a UX call (Privy embedded solves it with the user signing).

**Revocation — authority is the ISSUER, verified at read (money moment):**
The holder owns their identity, but NOT claim validity. Compliance revocation lives on the `ClaimIssuer`; the gate re-checks it at read (see §5), so a holder cannot undo it.
```solidity
// ClaimIssuer — per-user revocation LATCH (backend only needs identity + topic, no stored signatures)
mapping(address => mapping(uint256 => bool)) public revoked; // identity => topic
function setRevoked(address identity, uint256 topic, bool value) external onlyAgent { revoked[identity][topic] = value; }
// isClaimValid() returns false when revoked[identity][topic] → gate refuses at read,
// and re-adding ANY claim for that topic fails at write (submitClaim also calls isClaimValid).
```
**The revocation is a latch, not a by-signature kill.** While `revoked[identity][topic]` is true, no new claim for that topic can land (submitClaim reverts) — so the holder cannot self-heal by re-submitting. **Re-verification is issuer-gated:** the issuer re-approves → `setRevoked(id,topic,false)` → signs a fresh claim → holder submits. The user can never clear their own latch. This is *stronger* than canonical ONCHAINID by-signature revocation, which a fresh signature would bypass.
**Levers:** per-user `setRevoked(identity, topic, true/false)` · global `setSigner(signer,false)` (key compromise) · or de-trust the issuer in the `IssuerRegistry` (drops everyone on that issuer/topic).
The Identity also has a holder-side `revokeClaim` (voluntary removal) — not the compliance lever.

---

## 4. IssuerRegistry

```solidity
// issuer -> topic -> trusted
mapping(address => mapping(uint256 => bool)) private _trusted;
address[] private _issuersByTopic; // optional, to enumerate in eligibility

function isTrusted(address issuer, uint256 topic) external view returns (bool);
function setTrusted(address issuer, uint256 topic, bool ok) external onlyAdmin;
function issuersForTopic(uint256 topic) external view returns (address[] memory);
```
A **small set controlled by us** → this is what bounds the eligibility loop (not what attackers write).

---

## 5. EligibilityGate

```solidity
function isEligible(address identity, uint256 policyId)
    external view returns (bool ok, bytes32 reasonCode)
{
    uint256[] memory required = policy[policyId]; // required topics
    for (uint256 i = 0; i < required.length; i++) {
        if (!_hasValidClaim(identity, required[i])) {
            return (false, _reasonFor(required[i])); // e.g. "MISSING_KYC"
        }
    }
    return (true, bytes32(0));
}

function _hasValidClaim(address identity, uint256 topic) internal view returns (bool) {
    address[] memory issuers = issuerRegistry.issuersForTopic(topic); // bounded by us
    for (uint256 j = 0; j < issuers.length; j++) {
        (bool exists, bytes memory sig, bytes memory data) = IIdentity(identity).getClaim(topic, issuers[j]);
        if (!exists) continue;
        // AUTHORITATIVE: ask the issuer (checks per-user revocation + authorized signer + expiry)
        if (IClaimIssuer(issuers[j]).isClaimValid(identity, topic, sig, data)) return true;
    }
    return false;
}
```
- `policyId #1` = Deal Room (e.g. `KYC_VERIFIED`). Same interface consumed by the **ComplianceHook** and the **Transfer gate**.
- Loop dominated by `issuersForTopic` (ours), not by the identity's array.

---

## 6. Security notes

### Vector: griefing by stuffing
If `isEligible` iterated the identity's claims and writes were open, an attacker could inflate `topic → claims` on a **victim's** identity until the loop runs out of gas → `isEligible` always reverts → **victim locked out**. Attacks the integrity that is the project's thesis.

### The 3 options and why B
| | Who writes | "No privileged writer"? | Griefing |
|---|---|---|---|
| **A** — issuer holds CLAIM key (production) | issuer, on any identity | ❌ issuer is privileged | closed by keys |
| **B** — owner holds key of own identity ✅ **chosen** | the owner, on theirs | ✅ nobody writes to others' | closed by keys |
| **C** — open writes, signature only | anyone | ✅ | needs write-time check + cap |

**Model B** closes griefing **at the source** (keys block writing to others' identities) and honors "no privileged writer" (the issuer only signs; no global writer).

### Layered defenses (all kept)
1. **ERC-734 key** on write (blocks writing to someone else's identity).
2. **`isTrusted(issuer, topic)`** (a fake issuer doesn't pass).
3. **EIP-712 signature** bound to `identity` + nonce/`verificationIdHash` (anti-replay; A's claim isn't valid on B).
4. **`claimId = keccak(issuer, topic)`** (one slot per issuer/topic; re-issuance doesn't inflate).
5. **Read via `issuersForTopic`** (loop bounded by us).
6. **`MAX_CLAIMS_PER_TOPIC`** (hard cap, belt-and-suspenders).

### Privacy
`data` = hash/reference of the sanitized result only. Never a document, PII, or raw attester text. (**Zero-retention** invariant — same reason we declined Walrus.)

---

## 7. New vs. reused / IP
- **New (Lisbon):** all contracts above, written from scratch, generic, Apache-2.0.
- **Reused:** concepts and the SBT/UX from public PassportCreds.
- **NEVER:** copy production code. Only hashes on-chain.

## 8. Next specs
- `transfer-gate-spec.md` — ERC-20 with `_update` calling `EligibilityGate.isEligible` (the 4th surface; keep it **as simple as possible**).
