# Contracts Build Spec — Phase 1 (implementation blueprint)

> Function-level blueprint to build from **in-event**. Interfaces + state + events/errors + logic (bullets) + **acceptance tests** per contract.
> ⚠️ **Not final copy-paste code** — implement live with real incremental commits (pre-built dumps = DQ risk). Design rationale lives in the per-surface specs.

---

## Contract set & build order (by dependency)

```
0. Types/constants (lib)
1. Identity (ERC-734/735)                     ← core
2. IdentityFactory (wallet→identity resolver)
3. ClaimIssuer (EIP-712 signer)
4. IssuerRegistry (trusted issuers)
5. EligibilityGate (isEligible)               ← unblocks all surfaces
6. GatedERC20                (surface)  [transfer-gate-spec]
7. PassportResolver          (surface, tenant-aware)  [ens-spec §3]
8. PassportSubnameRegistrar  (surface, issues subnames by code)  [ens-spec §4]
9. ComplianceHook            (surface)  [uniswap-hook-spec]
```
> Count ≈ 9. "7/7" reconciliation if a strict count is wanted: fold **IssuerRegistry into EligibilityGate** and **PassportSubnameRegistrar into PassportResolver**. Kept separate here for clarity.

**Wiring (deploy script, after all deployed):**
- `ClaimIssuer.setSigner(backendSigner, true)`
- `IssuerRegistry.setTrusted(claimIssuer, KYC_VERIFIED, true)` (+ PERSONHOOD, ACCREDITED)
- `EligibilityGate.setPolicy(1, [KYC_VERIFIED])` (policy #1 = Deal Room/token/hook)
- `PassportResolver.setTenant(parentNode, gate, policyId=1, controller=registrar)` (tenant config)
- `PassportSubnameRegistrar` approved on the NameWrapper by the tenant (parent) owner
- `GatedERC20(gate, factory, policyId=1)` · `ComplianceHook(poolManager, gate, factory, policyId=1)`

---

## 0. Shared types / constants (library)

```solidity
library KeyPurpose { uint256 constant MANAGEMENT=1; uint256 constant ACTION=2; uint256 constant CLAIM=3; }

library ClaimTopics {
    uint256 constant KYC_VERIFIED        = uint256(keccak256("KYC_VERIFIED"));
    uint256 constant PROOF_OF_PERSONHOOD = uint256(keccak256("PROOF_OF_PERSONHOOD"));
    uint256 constant ACCREDITED_INVESTOR = uint256(keccak256("ACCREDITED_INVESTOR"));
}

// reasonCodes (bytes32) returned by the gate
// "OK" / "MISSING_KYC" / "MISSING_PERSONHOOD" / "MISSING_ACCREDITED" / "NO_IDENTITY"
```
- **Accept:** topics/purposes are stable across all contracts + backend + frontend (single source).

---

## 1. Identity (ERC-734/735) — `[onchainid-spec §1-3,6]`

**Interface**
```solidity
function keyHasPurpose(bytes32 key, uint256 purpose) external view returns (bool);
function submitClaim(uint256 topic, address issuer, bytes calldata sig, bytes calldata data, uint64 expiresAt) external returns (bytes32);
function revokeClaim(uint256 topic, address issuer) external;               // holder-side voluntary removal
function getClaim(uint256 topic, address issuer) external view returns (bool exists, bytes sig, bytes data);
```
**State:** keys (`keyForAddress`, purposes), `_claim[topic][issuer]`, `_countByTopic[topic]`, `MAX_CLAIMS_PER_TOPIC=16`.
**Events/Errors:** `ClaimAdded`, `ClaimRevoked`; `NoClaimKey`, `UntrustedIssuer`, `BadSignature`, `TopicCap`.
**Logic — `submitClaim` (Model B):** (1) `keyHasPurpose(sender, CLAIM)` (owner) · (2) `issuerRegistry.isTrusted(issuer, topic)` · (3) `IClaimIssuer(issuer).isClaimValid(this, topic, sig, data)` · cap check if new · store, `claimId=keccak(issuer,topic)`.
**Logic — `getClaim`:** `exists = _claim.exists && !revoked` (holder-removed reads as absent) + returns `sig`/`data`. Validity (expiry, issuer-revocation, signer) is decided by the issuer's `isClaimValid` at read — not here.
**Acceptance tests**
- ✅ owner submits a valid issuer-signed claim → stored; `getClaim` exists; gate eligible.
- ❌ non-owner (no CLAIM key) submits → revert `NoClaimKey`.
- ❌ untrusted issuer → revert `UntrustedIssuer`.
- ❌ tampered signature → revert `BadSignature`.
- ✅ re-issue same (issuer,topic) → updates in place, `_countByTopic` unchanged.
- ✅ holder `revokeClaim` → `getClaim` exists = false (voluntary removal).
- ✅ issuer `setRevoked(identity,topic,true)` or expiry → gate `isEligible` false (via issuer re-check).
- ❌ 17th distinct issuer on a topic → revert `TopicCap`.

## 2. IdentityFactory (resolver)

**Interface**
```solidity
function createIdentity(address wallet) external returns (address identity);
function identityOfWallet(address wallet) external view returns (address); // used by token + hook + resolver
```
**State:** `identityOf[wallet]`. **Event:** `IdentityCreated(wallet, identity)`.
**Logic:** deploy `new Identity(wallet, ...)` (wallet = MANAGEMENT+ACTION+CLAIM on their own identity); store; 1 per wallet.
**Acceptance tests**
- ✅ create → `identityOfWallet` returns it; identity has the wallet as MANAGEMENT.
- ❌ create twice for same wallet → revert.
- ✅ `identityOfWallet(unknown)` → `address(0)`.

## 3. ClaimIssuer (EIP-712) — `[onchainid-spec §3]`

**Interface**
```solidity
function isClaimValid(address identity, uint256 topic, bytes calldata sig, bytes calldata data) external view returns (bool);
function setSigner(address signer, bool ok) external; // admin
function setRevoked(address identity, uint256 topic, bool value) external;   // agent — per-user LATCH
function revoked(address identity, uint256 topic) external view returns (bool);
```
**State:** EIP-712 domain, `isAuthorizedSigner[addr]`, `revoked[identity][topic]` (per-user).
**Typehash:** `Claim(address identity,uint256 topic,bytes32 dataHash,uint64 expiresAt,bytes32 nonce)`.
**Logic — `isClaimValid`:** `!revoked[identity][topic]`; decode `(dataHash,expiresAt,nonce)`; not expired; `ecrecover(digest, sig)` ∈ authorized signers. Called at write AND read (the authority).
**Revocation is a LATCH (not by-signature):** `setRevoked(id,topic,true)` = revoke (blocks re-submission of that topic, since `submitClaim` also calls `isClaimValid`); `setRevoked(id,topic,false)` = re-open for re-verification. Only AGENT_ROLE flips it — the holder can never clear their own latch. Stronger than canonical by-signature revocation, which a fresh signature would bypass.
**Acceptance tests**
- ✅ signer signs → `isClaimValid` true.
- ❌ non-authorized signer → false.
- ❌ wrong identity (replay to another identity) → false.
- ❌ expired → false.
- ✅ `setRevoked(identity, topic, true)` → that claim false; another identity's claim unaffected (per-user).
- ❌ while revoked, a fresh valid signature still cannot land at `submitClaim` (latch holds).
- ✅ `setRevoked(identity, topic, false)` by issuer → fresh claim submits again (issuer-gated re-verify).
- ✅ `setSigner(signer,false)` → every claim from that signer invalid (global lever).

## 4. IssuerRegistry — `[onchainid-spec §4]`

**Interface**
```solidity
function isTrusted(address issuer, uint256 topic) external view returns (bool);
function issuersForTopic(uint256 topic) external view returns (address[] memory);
function setTrusted(address issuer, uint256 topic, bool ok) external; // admin
```
**State:** `_trusted[issuer][topic]`, `_issuers[topic][]` (enumerable).
**Acceptance tests**
- ✅ setTrusted → `isTrusted` true + appears in `issuersForTopic`.
- ✅ unset → removed from both.
- ❌ non-admin setTrusted → revert.

## 5. EligibilityGate — `[onchainid-spec §5]` ← unblocks surfaces

**Interface**
```solidity
function isEligible(address identity, uint256 policyId) external view returns (bool ok, bytes32 reasonCode);
function setPolicy(uint256 policyId, uint256[] calldata topics) external; // admin
```
**State:** `policy[policyId] = topics[]`, refs to `IdentityFactory`(?) + `IssuerRegistry`.
**Logic:** for each required topic → `_hasValidClaim` (loop `issuersForTopic`; `Identity.getClaim` → `IClaimIssuer.isClaimValid` **re-verify**: issuer-revocation + signer + expiry). First missing → `(false, reasonFor(topic))`. `identity==0` → `(false, "NO_IDENTITY")`.
**Acceptance tests**
- ✅ identity with all required topics → `(true, "OK"/0)`.
- ❌ missing KYC → `(false, "MISSING_KYC")`.
- ❌ revoked KYC → `(false, "MISSING_KYC")` (money moment).
- ❌ expired → false.
- ❌ identity==0 → `(false, "NO_IDENTITY")`.

## 6. GatedERC20 (surface) — `[transfer-gate-spec]`
Interface = ERC-20 + `_update` gate. **Acceptance:** mint→to eligible; transfer→from&to eligible (revoke→`NotEligible`); **burn always free**.

## 7. PassportResolver (surface, tenant-aware) — `[ens-spec §3]`
Interface = `text(node,key)` read-through + `setTenant(parentNode,gate,policyId,controller)` + `setIdentity(node,parentNode,identity)` + `supportsInterface(0x59d1d43c)`. State: `tenantOf[parentNode]`, `identityOf[node]`, `parentOf[node]`. **Acceptance:** `text(...,"compliance.status")` = GREEN, revoke → REVOKED (no tx on the name); two tenants with different gates resolve independently.

## 8. PassportSubnameRegistrar (surface) — `[ens-spec §4]`
Interface = `issueSubname(parentNode,label,userWallet,identity)` → `NameWrapper.setSubnodeRecord` + `resolver.setIdentity`. **Acceptance:** issuing creates `label.tenant.eth` owned by the user, resolver = PassportResolver, `text` resolves live; only the tenant-approved caller can issue.

## 9. ComplianceHook (surface) — `[uniswap-hook-spec]`
Interface = `BaseHook` `beforeSwap`+`beforeAddLiquidity`→gate; remove free. **Acceptance (in `ComplianceHook.t.sol`):** non-compliant swap reverts `NotCompliant`; after claim, passes; removeLiquidity always works.

---

## Global acceptance (integration)
```
onboard → World proof → issuer signs → holder submitClaim → dashboard GREEN
→ transfer OK · swap OK (test) · gated open · ENS = GREEN
→ revokeClaim(KYC)
→ transfer reverts · swap reverts (test) · gated closes · ENS = REVOKED
```
One `revokeClaim` flips every surface because they all read one `isEligible`.
