# Spec — Transfer Gate / GatedERC20 (PassportKit Node)

> The 4th enforcement surface. A minimal ERC-20 that consumes `EligibilityGate.isEligible(identity, policyId)` in `_update`.
> It is the "**transfer fails**" of the money moment. **Keep it as simple as possible** (cut order: can drop to a test-script under pressure).

---

## 0. Locked decisions

- **ERC-20 with `_update`** calling the `EligibilityGate` — no SPV rules module (that's the production product, out of scope).
- **Gate BOTH sides of a transfer** (`from` **and** `to`). This is what makes "revoke a claim → **your** transfer fails" happen on the sender side.
- **Free-exit principle** (unifies with the Uniswap hook):
  - ✅ **You can always exit:** `burn`/redeem (here) and `removeLiquidity` (hook). We never trap funds.
  - ❌ **You cannot move to a counterparty** while non-compliant: `transfer` (here) and `swap` (hook).
  - *Compliance blocks movement to a counterparty, never your own exit.*
- **Honest parity with production:** there, the production ERC-3643 token (`_update`-gated) does `identityRegistry.isVerified(to)` (recipient) + `compliance.canTransfer(...)`. Here we simplify: `EligibilityGate` is the eligibility half, applied to `from` and `to`.

---

## 1. Contract

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IEligibilityGate {
    function isEligible(address identity, uint256 policyId)
        external view returns (bool ok, bytes32 reasonCode);
}
interface IIdentityResolver {
    function identityOfWallet(address wallet) external view returns (address);
}

contract GatedERC20 is ERC20 {
    IEligibilityGate  public immutable gate;
    IIdentityResolver public immutable resolver; // wallet -> identity
    uint256           public immutable policyId; // e.g. requires KYC_VERIFIED

    error NotEligible(address wallet, bytes32 reasonCode);

    constructor(string memory n, string memory s, IEligibilityGate g, IIdentityResolver r, uint256 p)
        ERC20(n, s)
    { gate = g; resolver = r; policyId = p; }

    function _update(address from, address to, uint256 value) internal override {
        bool isMint = from == address(0);
        bool isBurn = to   == address(0);

        // real transfer (not mint, not burn): sender must be eligible → "transfer fails" on revocation
        if (!isMint && !isBurn) _requireEligible(from);
        // mint or transfer: recipient must be eligible (parity with isVerified(to))
        if (!isBurn) _requireEligible(to);
        // burn (to == 0): NO check → exit/redeem always free

        super._update(from, to, value);
    }

    function _requireEligible(address wallet) internal view {
        address identity = resolver.identityOfWallet(wallet);
        (bool ok, bytes32 reason) = gate.isEligible(identity, policyId);
        if (!ok) revert NotEligible(wallet, reason);
    }
}
```

Behavior matrix:

| Operation | `from` | `to` | Gate |
|---|---|---|---|
| **mint** | 0 | user | only `to` eligible |
| **burn / redeem** | user | 0 | **no gate** (free exit) |
| **transfer** | user | user | **`from` AND `to`** eligible |

---

## 2. Role in the money moment

```
1. Compliant wallet transfers OK
2. Revoke the KYC claim (revokeClaim)                → EligibilityGate.isEligible(from) = false
3. Same wallet tries to transfer                     → revert NotEligible(from, "MISSING_KYC")
4. (but can still burn/redeem — we don't trap)
```
"The transfer fails the moment compliance changes." The most direct surface of the triple refusal.

---

## 3. Design notes / edges

- **Doesn't trap funds:** `burn`/redeem always passes. A production-style recovery path (`forcedTransfer`/`recovery` by an agent) is a **roadmap note**, not a build item.
- **No identity = not eligible:** `identityOfWallet(wallet) == 0` → `isEligible` returns false. A wallet without an OnchainID neither receives nor transfers (can only be minted to after onboarding).
- **`reasonCode` in the error:** `NotEligible(wallet, reason)` lets the UI show *why* it failed (e.g. `MISSING_KYC`) — good for the demo.
- **Gas:** 2 read calls to the gate per transfer. Negligible.
- **Zero-retention/PII:** the gate only reads claims (hashes). No PII.

---

## 4. New vs. reused / IP
- **New (Lisbon):** the `GatedERC20` above, from scratch, generic, Apache-2.0.
- **Reused (concept):** the `_update`-gated pattern from the production ERC-3643 token — **reimplemented**, not copied. No SPV module, no partial freeze, no offering rules.
- **NEVER:** copy production code.

---

## 5. Build (minimal)
- [ ] `GatedERC20.sol` (above).
- [ ] `EligibilityGate` (OnchainID spec) already exposes `isEligible`.
- [ ] Test mint to 2 compliant wallets on Eth Sepolia.
- [ ] Demo: transfer OK → `revokeClaim` → transfer reverts `NotEligible`.
- [ ] (If pressured) drop to a **Foundry test-script** proving the revert — still counts as a surface.
