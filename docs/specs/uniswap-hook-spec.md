# Spec — ComplianceHook (Uniswap v4)

> Surface #4 of PassportKit. A v4 hook that **gates swap + add-liquidity** by compliance, reusing `EligibilityGate.isEligible(identity, policyId)` — the same interface as the Deal Room. Track: **Best Uniswap Stack Contribution** ($3k, continuity-only).

> **Status: implemented, as specified** — `contracts/src/hooks/ComplianceHook.sol`, tests in
> `contracts/test/ComplianceHook.t.sol`, demo via `make hook-demo`. The hook resolves
> `IdentityFactory.identityOfWallet(wallet)` and calls `EligibilityGate.isEligible(identity,
> policyId)`; a pool's policy is the immutable `policyId` (repo-wide: `1` = Deal Room / KYC,
> `2` = Investor / KYC + accredited). The revert carries the **gate's own** reason code
> (`MISSING_KYC`, `MISSING_ACCREDITED`, `NO_POLICY`, …), plus `NO_IDENTITY` for a wallet the
> resolver doesn't know — no reason logic of its own. Exit is ungated, actor via hookData
> (§3.1 limitation stands), address mining per §3.2.

---

## 1. Design
- ✅ `beforeSwap` — only a compliant wallet can trade (**demo hero**).
- ✅ `beforeAddLiquidity` — only a compliant wallet can provide liquidity.
- ❌ `beforeRemoveLiquidity` — **exit always free**: never trap funds of someone who lost compliance (e.g. expired claim). Good design + talking point.
- `afterSwap`/`afterAddLiquidity` — not used for the gate (accounting only). Optional: `afterSwap` to emit `CompliantSwap` (indexable).

Trust: the hook reads the Identity via a resolver (`identityOfWallet`) and calls the `EligibilityGate`. Zero new eligibility logic.

## 2. Contract

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {BaseHook} from "v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";

interface IEligibilityGate {
    function isEligible(address identity, uint256 policyId)
        external view returns (bool ok, bytes32 reasonCode);
}
interface IIdentityResolver {
    function identityOfWallet(address wallet) external view returns (address);
}

contract ComplianceHook is BaseHook {
    IEligibilityGate  public immutable gate;
    IIdentityResolver public immutable resolver; // MVP resolver (wallet -> identity)
    uint256           public immutable policyId; // e.g. requires KYC_VERIFIED

    error NotCompliant(address wallet, bytes32 reasonCode);

    constructor(IPoolManager _pm, IEligibilityGate _gate, IIdentityResolver _resolver, uint256 _policyId)
        BaseHook(_pm)
    { gate = _gate; resolver = _resolver; policyId = _policyId; }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false, afterInitialize: false,
            beforeAddLiquidity: true,       // gate LP entry
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,   // exit free — don't trap funds
            afterRemoveLiquidity: false,
            beforeSwap: true,               // gate swap
            afterSwap: false,
            beforeDonate: false, afterDonate: false,
            beforeSwapReturnDelta: false,   // we don't return a delta
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false, afterRemoveLiquidityReturnDelta: false
        });
    }

    function _beforeSwap(address sender, PoolKey calldata, SwapParams calldata, bytes calldata hookData)
        internal view override returns (bytes4, BeforeSwapDelta, uint24)
    {
        _requireCompliant(_actor(sender, hookData));
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata hookData)
        internal view override returns (bytes4)
    {
        _requireCompliant(_actor(sender, hookData));
        return BaseHook.beforeAddLiquidity.selector;
    }

    function _requireCompliant(address user) internal view {
        (bool ok, bytes32 reason) = gate.isEligible(resolver.identityOfWallet(user), policyId);
        if (!ok) revert NotCompliant(user, reason);
    }

    // `sender` in the hook = router/PositionManager (not the user) → actor comes in hookData.
    function _actor(address sender, bytes calldata hookData) internal pure returns (address) {
        return hookData.length == 32 ? abi.decode(hookData, (address)) : sender;
    }
}
```

## 3. v4 gotchas (respect them)
1. **`sender` ≠ user** — the v4 docs say "typically a swap router". We pass the user in `hookData`. ⚠️ Spoofable → in the hackathon we assume trusted periphery and **cite it as a limitation/roadmap** (bind by signature).
2. **Address mining** — v4 requires the hook address bits to encode the permissions. Deploy via **CREATE2 with a mined salt** (`HookMiner`); otherwise the `BaseHook` constructor reverts.
3. **`view`** — `_beforeSwap`/`_beforeAddLiquidity` can be `view` (only read + revert). If you emit an event, move it to `afterSwap` (non-`view`).

## 4. Feasibility & build path (TEST-SCRIPT-FIRST)

**Verdict:** doable — Uniswap ships the environment. De-riskers:
- **`v4-template`** (`uniswapfoundation/v4-template`) — Foundry with `v4-core`+`v4-periphery` pre-loaded + a script that deploys the whole v4 stack to **Anvil** (PoolManager, routers, tokens). We build no environment.
- **OZ Hooks Library** (`OpenZeppelin/uniswap-hooks`) — already in the template, secure `BaseHook`.
- **`HookMiner`** — solved boilerplate; and in **tests the `deployCodeTo` cheatcode SKIPS mining**.
- Everything runs on **Anvil** — no dependency on v4 being on the live testnet.

**Build order:**
1. [ ] Clone **`v4-template`** (env ready).
2. [ ] `ComplianceHook.sol` on `BaseHook` (§2).
3. [ ] `EligibilityGate`/`Identity`/`IssuerRegistry` (specs in this folder).
4. [ ] **`ComplianceHook.t.sol` — primary deliverable (= the cut-order "test-script proof"):** deploy the stack (template helper) + hook via `deployCodeTo` (skips mining) → create a pool with the hook → **assert:** non-compliant swap reverts `NotCompliant`; after issuing the claim, swap passes. *In the test, `sender=router` vanishes — we control the call.*
5. [ ] `FEEDBACK.md` + Uniswap Developer Feedback Form.
6. [ ] Keep scope to the hook — do **not** enter the API track ($7k).

**Upgrade (only if the rest is done):**
- [ ] Live deploy on **Ethereum Sepolia** via `HookMiner` + `CREATE2_DEPLOYER` (`0x4e59…4956C`) — confirm the Eth Sepolia `PoolManager` on the v4 deployments page.
- [ ] `forge script` with a live swap → tx hash for the submission.

**Avoid (rabbit hole):** a web swap UI (UniversalRouter + Permit2 + approvals). The revert is shown in the test/script.

## 5. Demo (WOW)
```
v4 pool with ComplianceHook, policyId = 1 (KYC_VERIFIED)
1) Wallet with no valid claim tries to swap  → revert NotCompliant(MISSING_KYC)
2) Issuer signs a KYC claim, holder submits  → claim on the Identity
3) Tries to swap again                        → passes ✅
4) Issuer setRevoked(identity, KYC, true)     → refused again (the money moment)
```
"A Uniswap pool only verified, compliant humans can trade in." Ties World + onchain-id + Uniswap into one scene.
