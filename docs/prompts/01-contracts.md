# Prompts — Contracts (Foundry, Ethereum Sepolia)

> Reference: `specs/contracts-build-spec.md` (interfaces + acceptance tests), `specs/onchainid-spec.md`, `specs/transfer-gate-spec.md`, `specs/ens-spec.md`, `specs/uniswap-hook-spec.md`.
> Build order by dependency. One contract → one commit + its tests.

## Setup
```
Prompt: "Set up a Foundry project (solc 0.8.26, evm cancun) with OpenZeppelin.
Add a `ClaimTopics` + `KeyPurpose` library exactly as in contracts-build-spec §0.
Write it, then a quick compile test."
```

## 1. Identity (ERC-734/735)
```
Prompt: "Implement `Identity` per onchainid-spec §1-3 and contracts-build-spec §1:
ERC-734 keys (MANAGEMENT/ACTION/CLAIM, MANAGEMENT satisfies any), ERC-735 claims stored
as _claim[topic][issuer], claimId=keccak(issuer,topic), MAX_CLAIMS_PER_TOPIC=16.
submitClaim = Model B (caller has CLAIM key + isTrusted + IClaimIssuer.isClaimValid + cap).
revokeClaim (holder-side voluntary), getClaim(topic,issuer)->(exists,sig,data). Then write ALL acceptance tests from contracts-build-spec §1."
```

## 2. IdentityFactory (resolver)
```
Prompt: "Implement `IdentityFactory` per §2: createIdentity(wallet) deploys Identity
(wallet=MANAGEMENT+ACTION+CLAIM), stores identityOf[wallet], 1 per wallet.
identityOfWallet(wallet) view. + acceptance tests."
```

## 3. ClaimIssuer (EIP-712)
```
Prompt: "Implement `ClaimIssuer` per onchainid-spec §3: EIP-712 typehash
Claim(address identity,uint256 topic,bytes32 dataHash,uint64 expiresAt,bytes32 nonce),
isAuthorizedSigner set, isClaimValid = !revoked[identity][topic] + not expired + signer authorized,
setRevoked(identity,topic,bool) per-user LATCH (AGENT_ROLE) — true blocks re-submission, false re-opens
for issuer-gated re-verify; setSigner global lever.
+ acceptance tests (valid, non-authorized, replay to another identity, expired, revoke blocks re-submit,
issuer re-opens → fresh claim lands, global setSigner off)."
```

## 4. IssuerRegistry
```
Prompt: "Implement `IssuerRegistry` per §4: isTrusted[issuer][topic], issuersForTopic(topic)
enumerable, setTrusted admin-only. + acceptance tests."
```

## 5. EligibilityGate (the core read)
```
Prompt: "Implement `EligibilityGate` per §5: isEligible(identity, policyId) → (bool, bytes32 reason);
policy[policyId]=topics[]; for each topic loop issuersForTopic, read Identity.getClaim, and
re-verify via IClaimIssuer.isClaimValid (authoritative: revocation + signer + expiry);
first missing → reason (MISSING_KYC etc.); identity==0 → NO_IDENTITY. setPolicy admin.
+ acceptance tests (all present, missing, revoked, expired, no-identity)."
```

## 6. GatedERC20 (surface — transfer gate)
```
Prompt: "Implement `GatedERC20` per transfer-gate-spec: ERC-20 whose _update gates from+to on
transfer, to on mint, burn ungated (free exit); resolves identity via IdentityFactory; reverts
NotEligible(wallet,reason). + acceptance tests: mint/burn/transfer matrix + revoke→transfer reverts."
```

## 7. PassportResolver (surface — ENS, tenant-aware read-through)
```
Prompt: "Implement `PassportResolver` per ens-spec §3: tenant-aware read-through ENS resolver.
tenantOf[parentNode]=(gate,policyId,controller); identityOf[node]; parentOf[node];
setTenant, setIdentity(node,parentNode,identity) (only tenant controller);
text(node,key) computes compliance.status live from the tenant's gate; supportsInterface(0x59d1d43c).
+ acceptance: GREEN→REVOKED after revoke, two tenants independent."
```

## 8. PassportSubnameRegistrar (surface — ENS by code)
```
Prompt: "Implement `PassportSubnameRegistrar` per ens-spec §4: issueSubname(parentNode,label,
userWallet,identity) calls NameWrapper.setSubnodeRecord(...resolver...) then resolver.setIdentity.
Only tenant-approved caller. + acceptance: creates subname owned by user, text resolves live."
```

## 9. ComplianceHook (surface — Uniswap v4, TEST-SCRIPT-FIRST)
```
Prompt: "Using the v4-template, implement `ComplianceHook` per uniswap-hook-spec §2:
BaseHook beforeSwap + beforeAddLiquidity call EligibilityGate via resolver; removeLiquidity free;
actor from hookData. THEN write `ComplianceHook.t.sol`: deploy the v4 stack (template helper) +
gate/identity, deploy hook via deployCodeTo (skip mining), create a pool, assert non-compliant
swap reverts NotCompliant and after a claim it passes. This test IS the deliverable."
```

## Deploy + wire
```
Prompt: "Write a Foundry deploy script for Ethereum Sepolia deploying all contracts and running
the wiring from contracts-build-spec (setSigner, setTrusted, setPolicy(1,[KYC]), setTenant,
approve registrar on NameWrapper). Output an address table for the README."
```
