# House Concierge Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An AI concierge for a house whose spending authority derives from its owners' live compliance passports — routine expenses paid autonomously from a token budget through a hook-gated Uniswap v4 pool, larger expenses via an m-of-n owner approval queue.

**Architecture:** Three new contracts (`HouseToken` scrip, `HouseTreasury` governance spine, `MandateHook` pool gate) on top of the untouched PassportCreds core; a Node agent runtime with a pluggable decision engine (mock → OpenAI-compatible → 0G stub); an x402-style mock vendor; a demo UI in the hook-demo skeleton. Spec: `docs/specs/agent-concierge-spec.md`.

**Tech Stack:** Foundry (solc 0.8.26, OZ v5, uniswap-hooks/v4-core already in `contracts/lib/`), Node 20 + viem + node:test, plain HTML/CSS demo.

## Global Constraints

- Branch: `feat/concierge` (already exists, based on `feat/v4-compliance-hook`). Commit after every task: **short imperative title, no body, no AI mentions** (e.g. `feat: house token`).
- Solidity: `pragma solidity ^0.8.24;`, MIT license header, NatSpec `@title/@notice/@dev`, SCREAMING_CASE immutables, `// --- Section ---` markers. Zero changes to `ClaimRegistry.sol`, `CompliancePassport.sol`, `AccessGate.sol`, `ComplianceHook.sol`.
- Tests: `forge test` from `contracts/` (all existing 64 must stay green); snake-case behavioral names (`test_x_when_y`); `makeAddr` actors; new Solidity tests deploy the REAL passport stack, never mocks of it.
- JS: ESM, no frameworks, viem only; `node --test test/` per app; adapter pattern with mock default (the product's "Simulate Verified" philosophy).
- Demo currency is `mUSD`; house scrip symbol `CASA`; amounts use 18 decimals (`2 ether` = 2 CASA).
- `contracts/lib/` is gitignored — never commit lib content. `apps/*/addresses.json` is generated — gitignored already.
- Anvil dev keys: operator `0xac09…ff80` (#0), ana `0x59c6…690d` (#1), rui `0x5de4…365a` (#2), concierge `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` (#3), plumber `0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a` (#4).

---

## File Structure

```
contracts/src/agents/HouseToken.sol          ERC-20 scrip, treasury-only mint/reclaim
contracts/src/agents/HouseTreasury.sol       owners, mandate, standing view, approval queue, funding
contracts/src/hooks/MandateHook.sol          gates the CASA/mUSD pool on treasury standing
contracts/test/agents/HouseToken.t.sol
contracts/test/agents/HouseTreasury.t.sol
contracts/test/agents/MandateHook.t.sol
contracts/script/DeployConciergeDemo.s.sol   anvil/testnet world; writes apps/concierge/addresses.json
apps/concierge/package.json                  viem dep, start/test scripts
apps/concierge/lib/evidence.js               canonical decision JSON + keccak hash
apps/concierge/lib/deciders.js               mock | openai | zerog decision adapters
apps/concierge/lib/decode.js                 WrappedError → NotAuthorized/NotCompliant decoder
apps/concierge/lib/x402.js                   x402-style client (402 → pay → retry with proof)
apps/concierge/vendor/server.js              mock plumber: quotes, 402 invoices, verifies payment
apps/concierge/server.js                     agent runtime + demo API + static UI host
apps/concierge/index.html                    Casa Azul demo page (PassportCreds branding)
apps/concierge/test/{evidence,deciders,x402,decode}.test.js
apps/concierge/env.example                   RPC/explorer/keys/DECIDER config template
docs: README.md section, CLAUDE.md, Makefile target, WHATS-NEW.md entry, spec status
```

---

### Task 1: HouseToken

**Files:**
- Create: `contracts/src/agents/HouseToken.sol`
- Test: `contracts/test/agents/HouseToken.t.sol`

**Interfaces:**
- Consumes: OZ `ERC20` (`@openzeppelin/contracts/token/ERC20/ERC20.sol`).
- Produces: `HouseToken(string name, string symbol, address treasury)`; `TREASURY() → address`; `mint(address to, uint256 amount)` treasury-only; `reclaim(address from, uint256 amount)` treasury-only (burns); error `NotTreasury()`.

- [ ] **Step 1: Write the failing tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HouseToken} from "../../src/agents/HouseToken.sol";

contract HouseTokenTest is Test {
    HouseToken token;
    address treasury = makeAddr("treasury");
    address agent = makeAddr("agent");

    function setUp() public {
        token = new HouseToken("Casa Azul Scrip", "CASA", treasury);
    }

    function test_treasury_can_mint() public {
        vm.prank(treasury);
        token.mint(agent, 100 ether);
        assertEq(token.balanceOf(agent), 100 ether);
    }

    function test_non_treasury_cannot_mint() public {
        vm.expectRevert(HouseToken.NotTreasury.selector);
        token.mint(agent, 1 ether);
    }

    function test_treasury_can_reclaim() public {
        vm.startPrank(treasury);
        token.mint(agent, 100 ether);
        token.reclaim(agent, 40 ether);
        vm.stopPrank();
        assertEq(token.balanceOf(agent), 60 ether);
    }

    function test_non_treasury_cannot_reclaim() public {
        vm.prank(treasury);
        token.mint(agent, 100 ether);
        vm.prank(agent);
        vm.expectRevert(HouseToken.NotTreasury.selector);
        token.reclaim(agent, 1 ether);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd contracts && forge test --match-contract HouseTokenTest`
Expected: compilation failure — `HouseToken.sol` not found.

- [ ] **Step 3: Implement**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title HouseToken
 * @notice ERC-20 house scrip. The concierge's routine budget is its balance.
 *         An allowance voucher, not money: only the house treasury mints, and the
 *         treasury can claw back (reclaim) at any time.
 */
contract HouseToken is ERC20 {
    error NotTreasury();

    address public immutable TREASURY;

    modifier onlyTreasury() {
        if (msg.sender != TREASURY) revert NotTreasury();
        _;
    }

    constructor(string memory name_, string memory symbol_, address treasury) ERC20(name_, symbol_) {
        TREASURY = treasury;
    }

    function mint(address to, uint256 amount) external onlyTreasury {
        _mint(to, amount);
    }

    function reclaim(address from, uint256 amount) external onlyTreasury {
        _burn(from, amount);
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd contracts && forge test --match-contract HouseTokenTest`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/agents/HouseToken.sol contracts/test/agents/HouseToken.t.sol
git commit -m "feat: house token"
```

---

### Task 2: HouseTreasury — mandate, standing, funding

**Files:**
- Create: `contracts/src/agents/HouseTreasury.sol`
- Test: `contracts/test/agents/HouseTreasury.t.sol`

**Interfaces:**
- Consumes: `HouseToken` (Task 1), `IAccessGate` (`../interfaces/IAccessGate.sol`), OZ `IERC20`/`SafeERC20`. Real stack in tests: `ClaimRegistry`, `CompliancePassport`, `AccessGate` (constructed exactly like `test/ComplianceHook.t.sol` does).
- Produces (used by Tasks 3–8):
  - `constructor(address[] owners_, uint256 approvalThreshold_, IERC20 spendToken, IAccessGate gate, string tokenName, string tokenSymbol)` — deploys its own `HouseToken`.
  - `HOUSE_TOKEN() → HouseToken`, `SPEND_TOKEN() → IERC20`, `ACCESS_GATE() → IAccessGate`.
  - `grantMandate(address agent, uint256 perTxCap, uint64 expiresAt)` / `revokeMandate()` — any single owner (fast brake; single-owner grant is a stated hackathon simplification).
  - `fundConcierge(uint256 casaAmount)` owner-only → mints CASA to agent.
  - `reclaimBudget(uint256 casaAmount)` owner-only.
  - `deposit(uint256 amount)` — anyone, `transferFrom` mUSD in.
  - `isAgentInGoodStanding(address) → (bool ok, bytes32 reason)` with reasons `NO_MANDATE`, `MANDATE_REVOKED`, `MANDATE_EXPIRED`, `OWNER_NOT_COMPLIANT`.
  - `isCompliantOwner(address) → bool`; `agentPerTxCap() → uint256`; `mandateAgent() → address`.
  - Events: `MandateGranted(address agent, uint256 perTxCap, uint64 expiresAt)`, `MandateRevoked(address agent)`, `ConciergeFunded(address agent, uint256 amount)`.
  - Errors: `NotOwner()`, `NoMandate()`, `ZeroAddress()`, `BadThreshold()`.

- [ ] **Step 1: Write the failing tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {ClaimRegistry} from "../../src/ClaimRegistry.sol";
import {CompliancePassport} from "../../src/CompliancePassport.sol";
import {AccessGate} from "../../src/AccessGate.sol";
import {IAccessGate} from "../../src/interfaces/IAccessGate.sol";
import {HouseTreasury} from "../../src/agents/HouseTreasury.sol";

contract HouseTreasuryTest is Test {
    ClaimRegistry registry;
    CompliancePassport passport;
    AccessGate gate;
    MockERC20 musd;
    HouseTreasury treasury;

    address admin = makeAddr("admin");
    address updater = makeAddr("updater");
    address ownerA = makeAddr("ownerA");
    address ownerB = makeAddr("ownerB");
    address concierge = makeAddr("concierge");
    address stranger = makeAddr("stranger");

    bytes32 constant KYC = keccak256("KYC_AML_VERIFIED");
    uint64 FUTURE;
    uint256 nonce;

    function setUp() public {
        FUTURE = uint64(block.timestamp + 365 days);
        registry = new ClaimRegistry(admin);
        passport = new CompliancePassport(admin, address(registry));
        gate = new AccessGate(address(registry), address(passport));
        vm.startPrank(admin);
        registry.grantRole(registry.CRE_UPDATER_ROLE(), updater);
        passport.grantRole(passport.CRE_UPDATER_ROLE(), updater);
        vm.stopPrank();

        _verifyKyc(ownerA);
        _verifyKyc(ownerB);

        musd = new MockERC20("Mock USD", "mUSD", 18);
        address[] memory owners = new address[](2);
        owners[0] = ownerA;
        owners[1] = ownerB;
        treasury = new HouseTreasury(owners, 2, IERC20(address(musd)), IAccessGate(address(gate)), "Casa Azul Scrip", "CASA");
    }

    // --- helpers ---

    function _verifyKyc(address user) internal {
        vm.startPrank(updater);
        registry.submitClaim(user, KYC, true, keccak256(abi.encode(nonce++)), keccak256("attest"), FUTURE);
        passport.syncPassport(user);
        vm.stopPrank();
    }

    function _grant() internal {
        vm.prank(ownerA);
        treasury.grantMandate(concierge, 200 ether, FUTURE);
    }

    // --- mandate + standing ---

    function test_standing_no_mandate() public view {
        (bool ok, bytes32 reason) = treasury.isAgentInGoodStanding(concierge);
        assertFalse(ok);
        assertEq(reason, bytes32("NO_MANDATE"));
    }

    function test_standing_ok_after_grant() public {
        _grant();
        (bool ok, bytes32 reason) = treasury.isAgentInGoodStanding(concierge);
        assertTrue(ok);
        assertEq(reason, bytes32(0));
    }

    function test_standing_wrong_wallet_is_no_mandate() public {
        _grant();
        (bool ok, bytes32 reason) = treasury.isAgentInGoodStanding(stranger);
        assertFalse(ok);
        assertEq(reason, bytes32("NO_MANDATE"));
    }

    function test_standing_revoked() public {
        _grant();
        vm.prank(ownerB);
        treasury.revokeMandate();
        (bool ok, bytes32 reason) = treasury.isAgentInGoodStanding(concierge);
        assertFalse(ok);
        assertEq(reason, bytes32("MANDATE_REVOKED"));
    }

    function test_standing_expired() public {
        _grant();
        vm.warp(uint256(FUTURE) + 1);
        (bool ok, bytes32 reason) = treasury.isAgentInGoodStanding(concierge);
        assertFalse(ok);
        assertEq(reason, bytes32("MANDATE_EXPIRED"));
    }

    function test_standing_dies_with_owner_compliance() public {
        _grant();
        vm.prank(admin);
        passport.revokePassport(ownerB); // one owner loses compliance
        (bool ok, bytes32 reason) = treasury.isAgentInGoodStanding(concierge);
        assertFalse(ok);
        assertEq(reason, bytes32("OWNER_NOT_COMPLIANT"));
    }

    function test_only_owner_grants_and_revokes() public {
        vm.prank(stranger);
        vm.expectRevert(HouseTreasury.NotOwner.selector);
        treasury.grantMandate(concierge, 1 ether, FUTURE);
        _grant();
        vm.prank(stranger);
        vm.expectRevert(HouseTreasury.NotOwner.selector);
        treasury.revokeMandate();
    }

    // --- funding ---

    function test_fund_concierge_mints_casa() public {
        _grant();
        vm.prank(ownerA);
        treasury.fundConcierge(50 ether);
        assertEq(treasury.HOUSE_TOKEN().balanceOf(concierge), 50 ether);
    }

    function test_reclaim_budget_burns_casa() public {
        _grant();
        vm.startPrank(ownerA);
        treasury.fundConcierge(50 ether);
        treasury.reclaimBudget(20 ether);
        vm.stopPrank();
        assertEq(treasury.HOUSE_TOKEN().balanceOf(concierge), 30 ether);
    }

    function test_fund_requires_mandate() public {
        vm.prank(ownerA);
        vm.expectRevert(HouseTreasury.NoMandate.selector);
        treasury.fundConcierge(1 ether);
    }

    function test_deposit_pulls_spend_token() public {
        musd.mint(ownerA, 100 ether);
        vm.startPrank(ownerA);
        musd.approve(address(treasury), 100 ether);
        treasury.deposit(100 ether);
        vm.stopPrank();
        assertEq(musd.balanceOf(address(treasury)), 100 ether);
    }

    function test_is_compliant_owner() public {
        assertTrue(treasury.isCompliantOwner(ownerA));
        assertFalse(treasury.isCompliantOwner(stranger));
        vm.prank(admin);
        passport.revokePassport(ownerA);
        assertFalse(treasury.isCompliantOwner(ownerA));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd contracts && forge test --match-contract HouseTreasuryTest`
Expected: compilation failure — `HouseTreasury.sol` not found.

- [ ] **Step 3: Implement (mandate/standing/funding portion; payment queue fields included but functions come in Task 3)**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IAccessGate} from "../interfaces/IAccessGate.sol";
import {HouseToken} from "./HouseToken.sol";

/**
 * @title HouseTreasury
 * @notice Governance spine of a house: owners, the concierge's mandate, the
 *         above-threshold approval queue, and funding of the concierge's CASA budget.
 *
 * The concierge never holds a passport. Its authority derives from the owners:
 * isAgentInGoodStanding re-checks every owner against AccessGate live, so revoking
 * one owner's KYC instantly cuts the agent off everywhere this view is consulted.
 */
contract HouseTreasury {
    using SafeERC20 for IERC20;

    error NotOwner();
    error NotAgent();
    error NoMandate();
    error ZeroAddress();
    error BadThreshold();
    error UnknownPayment();
    error AlreadyApproved();
    error AlreadyExecuted();
    error ThresholdNotMet();

    event MandateGranted(address indexed agent, uint256 perTxCap, uint64 expiresAt);
    event MandateRevoked(address indexed agent);
    event ConciergeFunded(address indexed agent, uint256 amount);
    event Deposited(address indexed from, uint256 amount);
    event PaymentProposed(uint256 indexed id, address indexed vendor, uint256 amount, bytes32 evidenceHash);
    event PaymentApproved(uint256 indexed id, address indexed owner, uint256 approvals);
    event PaymentExecuted(uint256 indexed id, address indexed vendor, uint256 amount);

    struct Mandate {
        address agent;
        uint256 perTxCap;
        uint64 expiresAt;
        bool revoked;
    }

    struct PendingPayment {
        address vendor;
        uint256 amount;
        bytes32 evidenceHash;
        uint256 approvals;
        bool executed;
    }

    IERC20 public immutable SPEND_TOKEN;
    IAccessGate public immutable ACCESS_GATE;
    HouseToken public immutable HOUSE_TOKEN;

    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public immutable APPROVAL_THRESHOLD;

    Mandate public mandate;
    uint256 public nextPaymentId = 1;
    mapping(uint256 => PendingPayment) public payments;
    mapping(uint256 => mapping(address => bool)) public approvedBy;

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    constructor(
        address[] memory owners_,
        uint256 approvalThreshold_,
        IERC20 spendToken,
        IAccessGate gate,
        string memory tokenName,
        string memory tokenSymbol
    ) {
        if (owners_.length == 0) revert ZeroAddress();
        if (approvalThreshold_ == 0 || approvalThreshold_ > owners_.length) revert BadThreshold();
        for (uint256 i = 0; i < owners_.length; i++) {
            if (owners_[i] == address(0)) revert ZeroAddress();
            owners.push(owners_[i]);
            isOwner[owners_[i]] = true;
        }
        APPROVAL_THRESHOLD = approvalThreshold_;
        SPEND_TOKEN = spendToken;
        ACCESS_GATE = gate;
        HOUSE_TOKEN = new HouseToken(tokenName, tokenSymbol, address(this));
    }

    // --- Mandate ---

    /// @notice Any single owner grants/revokes — revoke is a fast brake by design;
    ///         single-owner grant is a stated hackathon simplification.
    function grantMandate(address agent, uint256 perTxCap, uint64 expiresAt) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        mandate = Mandate({ agent: agent, perTxCap: perTxCap, expiresAt: expiresAt, revoked: false });
        emit MandateGranted(agent, perTxCap, expiresAt);
    }

    function revokeMandate() external onlyOwner {
        if (mandate.agent == address(0)) revert NoMandate();
        mandate.revoked = true;
        emit MandateRevoked(mandate.agent);
    }

    // --- Standing (the single view every surface gates on) ---

    function isAgentInGoodStanding(address wallet) public view returns (bool ok, bytes32 reason) {
        if (mandate.agent == address(0) || wallet != mandate.agent) return (false, "NO_MANDATE");
        if (mandate.revoked) return (false, "MANDATE_REVOKED");
        if (mandate.expiresAt != 0 && block.timestamp > mandate.expiresAt) return (false, "MANDATE_EXPIRED");
        for (uint256 i = 0; i < owners.length; i++) {
            if (!ACCESS_GATE.canAccessDealRoom(owners[i])) return (false, "OWNER_NOT_COMPLIANT");
        }
        return (true, bytes32(0));
    }

    function isCompliantOwner(address wallet) public view returns (bool) {
        return isOwner[wallet] && ACCESS_GATE.canAccessDealRoom(wallet);
    }

    function agentPerTxCap() external view returns (uint256) {
        return mandate.perTxCap;
    }

    function mandateAgent() external view returns (address) {
        return mandate.agent;
    }

    function ownersCount() external view returns (uint256) {
        return owners.length;
    }

    // --- Funding ---

    function fundConcierge(uint256 casaAmount) external onlyOwner {
        if (mandate.agent == address(0)) revert NoMandate();
        HOUSE_TOKEN.mint(mandate.agent, casaAmount);
        emit ConciergeFunded(mandate.agent, casaAmount);
    }

    function reclaimBudget(uint256 casaAmount) external onlyOwner {
        if (mandate.agent == address(0)) revert NoMandate();
        HOUSE_TOKEN.reclaim(mandate.agent, casaAmount);
    }

    function deposit(uint256 amount) external {
        SPEND_TOKEN.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd contracts && forge test --match-contract HouseTreasuryTest`
Expected: 12 passed. Also run full suite: `forge test` — everything green.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/agents/HouseTreasury.sol contracts/test/agents/HouseTreasury.t.sol
git commit -m "feat: house treasury mandate and standing"
```

---

### Task 3: HouseTreasury — approval queue (rail 2)

**Files:**
- Modify: `contracts/src/agents/HouseTreasury.sol` (append functions in a `// --- Payments ---` section)
- Modify: `contracts/test/agents/HouseTreasury.t.sol` (append tests)

**Interfaces:**
- Produces (used by concierge runtime, Task 7+):
  - `proposePayment(address vendor, uint256 amount, bytes32 evidenceHash) → uint256 id` — agent-only, requires good standing (reverts `NotAgent()` otherwise, incl. all standing failures).
  - `approvePayment(uint256 id)` — owner-only, once per owner.
  - `executePayment(uint256 id)` — anyone once `approvals >= APPROVAL_THRESHOLD`; pays mUSD to vendor.
  - `getPayment(uint256 id) → PendingPayment` (public mapping getter `payments(id)` suffices for viem).

- [ ] **Step 1: Append failing tests**

```solidity
    // --- payments (rail 2) ---

    function _fundTreasury(uint256 amount) internal {
        musd.mint(ownerA, amount);
        vm.startPrank(ownerA);
        musd.approve(address(treasury), amount);
        treasury.deposit(amount);
        vm.stopPrank();
    }

    function test_propose_requires_good_standing() public {
        vm.prank(concierge);
        vm.expectRevert(HouseTreasury.NotAgent.selector);
        treasury.proposePayment(stranger, 1 ether, keccak256("evidence"));
    }

    function test_full_approval_flow_pays_vendor() public {
        _grant();
        _fundTreasury(5_000 ether);
        vm.prank(concierge);
        uint256 id = treasury.proposePayment(stranger, 4_500 ether, keccak256("roof"));

        vm.prank(ownerA);
        treasury.approvePayment(id);
        vm.prank(ownerB);
        treasury.approvePayment(id);
        treasury.executePayment(id);

        assertEq(musd.balanceOf(stranger), 4_500 ether);
    }

    function test_execute_before_threshold_reverts() public {
        _grant();
        _fundTreasury(5_000 ether);
        vm.prank(concierge);
        uint256 id = treasury.proposePayment(stranger, 100 ether, keccak256("e"));
        vm.prank(ownerA);
        treasury.approvePayment(id);
        vm.expectRevert(HouseTreasury.ThresholdNotMet.selector);
        treasury.executePayment(id);
    }

    function test_owner_cannot_double_approve() public {
        _grant();
        vm.prank(concierge);
        uint256 id = treasury.proposePayment(stranger, 100 ether, keccak256("e"));
        vm.startPrank(ownerA);
        treasury.approvePayment(id);
        vm.expectRevert(HouseTreasury.AlreadyApproved.selector);
        treasury.approvePayment(id);
        vm.stopPrank();
    }

    function test_cannot_execute_twice() public {
        _grant();
        _fundTreasury(1_000 ether);
        vm.prank(concierge);
        uint256 id = treasury.proposePayment(stranger, 100 ether, keccak256("e"));
        vm.prank(ownerA);
        treasury.approvePayment(id);
        vm.prank(ownerB);
        treasury.approvePayment(id);
        treasury.executePayment(id);
        vm.expectRevert(HouseTreasury.AlreadyExecuted.selector);
        treasury.executePayment(id);
    }

    function test_kill_switch_blocks_new_proposals() public {
        _grant();
        vm.prank(admin);
        passport.revokePassport(ownerA);
        vm.prank(concierge);
        vm.expectRevert(HouseTreasury.NotAgent.selector);
        treasury.proposePayment(stranger, 1 ether, keccak256("e"));
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cd contracts && forge test --match-contract HouseTreasuryTest`
Expected: compilation failure — `proposePayment` undefined.

- [ ] **Step 3: Append implementation to HouseTreasury.sol**

```solidity
    // --- Payments (rail 2: above-threshold, owner-approved) ---

    function proposePayment(address vendor, uint256 amount, bytes32 evidenceHash)
        external
        returns (uint256 id)
    {
        (bool ok,) = isAgentInGoodStanding(msg.sender);
        if (!ok) revert NotAgent();
        if (vendor == address(0)) revert ZeroAddress();
        id = nextPaymentId++;
        payments[id] = PendingPayment({
            vendor: vendor,
            amount: amount,
            evidenceHash: evidenceHash,
            approvals: 0,
            executed: false
        });
        emit PaymentProposed(id, vendor, amount, evidenceHash);
    }

    function approvePayment(uint256 id) external onlyOwner {
        PendingPayment storage p = payments[id];
        if (p.vendor == address(0)) revert UnknownPayment();
        if (p.executed) revert AlreadyExecuted();
        if (approvedBy[id][msg.sender]) revert AlreadyApproved();
        approvedBy[id][msg.sender] = true;
        p.approvals++;
        emit PaymentApproved(id, msg.sender, p.approvals);
    }

    function executePayment(uint256 id) external {
        PendingPayment storage p = payments[id];
        if (p.vendor == address(0)) revert UnknownPayment();
        if (p.executed) revert AlreadyExecuted();
        if (p.approvals < APPROVAL_THRESHOLD) revert ThresholdNotMet();
        p.executed = true;
        SPEND_TOKEN.safeTransfer(p.vendor, p.amount);
        emit PaymentExecuted(id, p.vendor, p.amount);
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd contracts && forge test` — HouseTreasuryTest 18 passed, all suites green.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/agents/HouseTreasury.sol contracts/test/agents/HouseTreasury.t.sol
git commit -m "feat: treasury approval queue"
```

---

### Task 4: MandateHook

**Files:**
- Create: `contracts/src/hooks/MandateHook.sol`
- Test: `contracts/test/agents/MandateHook.t.sol`

**Interfaces:**
- Consumes: `HouseTreasury.isAgentInGoodStanding/isCompliantOwner/agentPerTxCap` (Tasks 2–3); BaseHook + v4 types exactly as `ComplianceHook.sol` imports them; test harness pieces from `test/ComplianceHook.t.sol` (PoolManager, PoolSwapTest, `DemoPositionRouter`, `deployCodeTo` with flags `BEFORE_SWAP_FLAG | BEFORE_ADD_LIQUIDITY_FLAG`).
- Produces: `MandateHook(IPoolManager, IHouseTreasuryStanding treasury)` where the interface is declared in the hook file as
  `interface IHouseTreasuryStanding { function isAgentInGoodStanding(address) external view returns (bool, bytes32); function isCompliantOwner(address) external view returns (bool); function agentPerTxCap() external view returns (uint256); }`;
  error `NotAuthorized(address wallet, bytes32 reasonCode)`; reasons passed through from treasury plus `OVER_PER_TX_CAP` and `NOT_OWNER`.

- [ ] **Step 1: Write the failing tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {IPoolManager, SwapParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {ClaimRegistry} from "../../src/ClaimRegistry.sol";
import {CompliancePassport} from "../../src/CompliancePassport.sol";
import {AccessGate} from "../../src/AccessGate.sol";
import {IAccessGate} from "../../src/interfaces/IAccessGate.sol";
import {HouseTreasury} from "../../src/agents/HouseTreasury.sol";
import {MandateHook} from "../../src/hooks/MandateHook.sol";
import {DemoPositionRouter} from "../../src/demo/DemoPositionRouter.sol";

contract MandateHookTest is Test {
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    ClaimRegistry registry;
    CompliancePassport passport;
    AccessGate gate;
    HouseTreasury treasury;
    MockERC20 musd;

    PoolManager poolManager;
    PoolSwapTest swapRouter;
    DemoPositionRouter liquidityRouter;
    MandateHook hook;
    PoolKey poolKey;

    address admin = makeAddr("admin");
    address updater = makeAddr("updater");
    address ownerA = makeAddr("ownerA");
    address ownerB = makeAddr("ownerB");
    address concierge = makeAddr("concierge");
    address stranger = makeAddr("stranger");

    bytes32 constant KYC = keccak256("KYC_AML_VERIFIED");
    uint64 FUTURE;
    uint256 nonce;

    function setUp() public {
        FUTURE = uint64(block.timestamp + 365 days);
        registry = new ClaimRegistry(admin);
        passport = new CompliancePassport(admin, address(registry));
        gate = new AccessGate(address(registry), address(passport));
        vm.startPrank(admin);
        registry.grantRole(registry.CRE_UPDATER_ROLE(), updater);
        passport.grantRole(passport.CRE_UPDATER_ROLE(), updater);
        vm.stopPrank();
        _verifyKyc(ownerA);
        _verifyKyc(ownerB);

        musd = new MockERC20("Mock USD", "mUSD", 18);
        address[] memory owners = new address[](2);
        owners[0] = ownerA;
        owners[1] = ownerB;
        treasury = new HouseTreasury(owners, 2, IERC20(address(musd)), IAccessGate(address(gate)), "Casa", "CASA");
        vm.prank(ownerA);
        treasury.grantMandate(concierge, 100 ether, FUTURE);
        vm.prank(ownerA);
        treasury.fundConcierge(500 ether);

        poolManager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(poolManager);
        liquidityRouter = new DemoPositionRouter(poolManager);

        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);
        hook = MandateHook(address(flags ^ (0x4446 << 144)));
        deployCodeTo("MandateHook.sol:MandateHook", abi.encode(poolManager, treasury), address(hook));

        address casaAddr = address(treasury.HOUSE_TOKEN());
        (address t0, address t1) = casaAddr < address(musd) ? (casaAddr, address(musd)) : (address(musd), casaAddr);
        poolKey = PoolKey(Currency.wrap(t0), Currency.wrap(t1), 3000, 60, IHooks(address(hook)));
        poolManager.initialize(poolKey, SQRT_PRICE_1_1);

        // ownerA LPs the pool: needs both tokens (owners can self-mint CASA via a
        // second fundConcierge? no — owners LP mUSD + CASA minted to owner for seeding)
        vm.prank(ownerB);
        treasury.grantMandate(ownerA, 0, FUTURE); // temporarily mandate ownerA to mint seed CASA
        vm.prank(ownerB);
        treasury.fundConcierge(10_000 ether); // mints to ownerA (current mandate agent)
        vm.prank(ownerB);
        treasury.grantMandate(concierge, 100 ether, FUTURE); // restore the real mandate
        musd.mint(ownerA, 10_000 ether);

        vm.startPrank(ownerA);
        treasury.HOUSE_TOKEN().approve(address(liquidityRouter), type(uint256).max);
        musd.approve(address(liquidityRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity(
            poolKey, TickMath.minUsableTick(60), TickMath.maxUsableTick(60), 5_000e18, abi.encode(ownerA)
        );
        vm.stopPrank();

        vm.startPrank(concierge);
        treasury.HOUSE_TOKEN().approve(address(swapRouter), type(uint256).max);
        musd.approve(address(swapRouter), type(uint256).max);
        vm.stopPrank();
    }

    function _verifyKyc(address user) internal {
        vm.startPrank(updater);
        registry.submitClaim(user, KYC, true, keccak256(abi.encode(nonce++)), keccak256("attest"), FUTURE);
        passport.syncPassport(user);
        vm.stopPrank();
    }

    function _swapAsConcierge(int256 amountSpecified) internal {
        bool casaIsToken0 = Currency.unwrap(poolKey.currency0) == address(treasury.HOUSE_TOKEN());
        vm.prank(concierge);
        swapRouter.swap(
            poolKey,
            SwapParams({
                zeroForOne: casaIsToken0,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: casaIsToken0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            abi.encode(concierge)
        );
    }

    function _expectNotAuthorized(bytes4 hookFn, address wallet, bytes32 reason) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                hookFn,
                abi.encodeWithSelector(MandateHook.NotAuthorized.selector, wallet, reason),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }

    function test_agent_in_good_standing_can_swap() public {
        uint256 before = musd.balanceOf(concierge);
        _swapAsConcierge(-10e18);
        assertGt(musd.balanceOf(concierge), before);
    }

    function test_agent_swap_over_per_tx_cap_blocked() public {
        _expectNotAuthorized(IHooks.beforeSwap.selector, concierge, "OVER_PER_TX_CAP");
        _swapAsConcierge(-150e18); // cap is 100
    }

    function test_stranger_cannot_swap() public {
        vm.startPrank(stranger);
        vm.expectRevert(); // wrapped NotAuthorized(NO_MANDATE); exact bytes checked above pattern
        swapRouter.swap(
            poolKey,
            SwapParams({ zeroForOne: true, amountSpecified: -1e18, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1 }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            abi.encode(stranger)
        );
        vm.stopPrank();
    }

    function test_owner_revocation_kills_agent_swaps() public {
        vm.prank(admin);
        passport.revokePassport(ownerB);
        _expectNotAuthorized(IHooks.beforeSwap.selector, concierge, "OWNER_NOT_COMPLIANT");
        _swapAsConcierge(-1e18);
    }

    function test_mandate_revocation_kills_agent_swaps() public {
        vm.prank(ownerA);
        treasury.revokeMandate();
        _expectNotAuthorized(IHooks.beforeSwap.selector, concierge, "MANDATE_REVOKED");
        _swapAsConcierge(-1e18);
    }

    function test_non_owner_cannot_add_liquidity() public {
        _expectNotAuthorized(IHooks.beforeAddLiquidity.selector, concierge, "NOT_OWNER");
        vm.prank(concierge);
        liquidityRouter.modifyLiquidity(poolKey, -887220, 887220, 1e18, abi.encode(concierge));
    }

    function test_owner_exit_always_free_even_when_not_compliant() public {
        vm.prank(admin);
        passport.revokePassport(ownerA);
        vm.prank(ownerA);
        liquidityRouter.modifyLiquidity(poolKey, -887220, 887220, -1_000e18, abi.encode(ownerA));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd contracts && forge test --match-contract MandateHookTest`
Expected: compilation failure — `MandateHook.sol` not found.

- [ ] **Step 3: Implement**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager, SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

/// The slice of HouseTreasury the hook needs.
interface IHouseTreasuryStanding {
    function isAgentInGoodStanding(address wallet) external view returns (bool, bytes32);
    function isCompliantOwner(address wallet) external view returns (bool);
    function agentPerTxCap() external view returns (uint256);
}

/**
 * @title MandateHook
 * @notice Gates a house's CASA/mUSD budget pool. Compliant owners may LP and trade;
 *         the house's agent may swap (liquify its budget) while in good standing and
 *         within its per-transaction cap. Everyone else is refused. Exit is never
 *         gated. Actor arrives via hookData (see ComplianceHook — same trust caveat).
 */
contract MandateHook is BaseHook {
    error NotAuthorized(address wallet, bytes32 reasonCode);

    IHouseTreasuryStanding public immutable TREASURY;

    constructor(IPoolManager poolManager, IHouseTreasuryStanding treasury) BaseHook(poolManager) {
        TREASURY = treasury;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _beforeSwap(address sender, PoolKey calldata, SwapParams calldata params, bytes calldata hookData)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        address actor = _actor(sender, hookData);
        if (!TREASURY.isCompliantOwner(actor)) {
            (bool ok, bytes32 reason) = TREASURY.isAgentInGoodStanding(actor);
            if (!ok) revert NotAuthorized(actor, reason);
            uint256 magnitude = params.amountSpecified < 0
                ? uint256(-params.amountSpecified)
                : uint256(params.amountSpecified);
            if (magnitude > TREASURY.agentPerTxCap()) revert NotAuthorized(actor, "OVER_PER_TX_CAP");
        }
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata hookData)
        internal
        view
        override
        returns (bytes4)
    {
        address actor = _actor(sender, hookData);
        if (!TREASURY.isCompliantOwner(actor)) revert NotAuthorized(actor, "NOT_OWNER");
        return BaseHook.beforeAddLiquidity.selector;
    }

    function _actor(address sender, bytes calldata hookData) internal pure returns (address) {
        return hookData.length == 32 ? abi.decode(hookData, (address)) : sender;
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd contracts && forge test` — MandateHookTest 7 passed, all suites green (73 total expected).

- [ ] **Step 5: Commit**

```bash
git add contracts/src/hooks/MandateHook.sol contracts/test/agents/MandateHook.t.sol
git commit -m "feat: mandate hook for budget pool"
```

---

### Task 5: DeployConciergeDemo script

**Files:**
- Create: `contracts/script/DeployConciergeDemo.s.sol`
- Modify: `contracts/foundry.toml` — extend `fs_permissions` with `{ access = "read-write", path = "../apps/concierge/" }`

**Interfaces:**
- Consumes: everything above + the exact structure of `DeployHookDemo.s.sol` (env keys via `vm.envOr`, `HookMiner`, `_etch`-free local deploy, `PoolSwapTest`, `DemoPositionRouter`).
- Produces: `apps/concierge/addresses.json` with keys `chainId, deployBlock, claimRegistry, compliancePassport, accessGate, poolManager, swapRouter, liquidityRouter, musd, casa, treasury, mandateHook, fee (3000), tickSpacing (60), actors { operator, ana, concierge, plumber }` (ana + operator are the owners; rui is unused here). Cast of anvil keys per Global Constraints.

- [ ] **Step 1: Write the script** (mirror `DeployHookDemo.s.sol`; the shape below is complete — copy the `_writeAddresses` string-concat pattern from DeployHookDemo for the JSON):

World built by `run()` (all under `vm.startBroadcast(OPERATOR_PK)` except actor approvals):
1. Passport stack + roles to operator (CRE role) — same as DeployHookDemo `_deployStack`.
2. Verify KYC for operator AND ana (both are house owners; ana's key from `ANA_PK`).
3. `musd = new MockERC20("Mock USD", "mUSD", 18)`; mint 1,000,000 to operator, 1,000 to ana.
4. `owners = [operator, ana]`, `treasury = new HouseTreasury(owners, 2, musd, gate, "Casa Azul Scrip", "CASA")`; `musd.approve(treasury)`; `treasury.deposit(50_000 ether)`.
5. `treasury.grantMandate(CONCIERGE, 200 ether, uint64(block.timestamp + 365 days))` where `CONCIERGE = vm.addr(CONCIERGE_PK)`; `treasury.fundConcierge(500 ether)`.
6. v4: `poolManager` (env `POOL_MANAGER` or fresh), `swapRouter = new PoolSwapTest`, `liquidityRouter = new DemoPositionRouter`.
7. MandateHook via `HookMiner.find(CREATE2_FACTORY, flags, type(MandateHook).creationCode, abi.encode(poolManager, treasury))`, flags `BEFORE_SWAP_FLAG | BEFORE_ADD_LIQUIDITY_FLAG`.
8. Pool CASA/mUSD (sort addresses for currency0/1), initialize at `79228162514264337593543950336`.
9. Seed liquidity as operator: mint seed CASA to operator via the temporary-mandate trick used in MandateHookTest.setUp (grant operator a zero-cap mandate, `fundConcierge(20_000 ether)`, restore concierge mandate), approve both tokens to `liquidityRouter`, `modifyLiquidity(key, min, max, 10_000e18, abi.encode(operator))`.
10. Broadcast as CONCIERGE_PK: approve CASA + mUSD to `swapRouter`. Broadcast as ANA_PK: approve mUSD to `liquidityRouter` and `treasury`.
11. `_writeAddresses()` → `../apps/concierge/addresses.json`.

Env constants at top (with anvil defaults, non-local guard exactly like DeployHookDemo):
```solidity
uint256 constant ANVIL_OPERATOR_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
uint256 constant ANVIL_ANA_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
uint256 constant ANVIL_CONCIERGE_PK = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
uint256 constant ANVIL_PLUMBER_PK = 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a;
```
(env names: `OPERATOR_PK`, `ANA_PK`, `CONCIERGE_PK`, `PLUMBER_PK`, `POOL_MANAGER`.)

- [ ] **Step 2: Run against local anvil**

```bash
pkill anvil; anvil --silent &   # fresh chain
cd contracts && forge script script/DeployConciergeDemo.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
cat ../apps/concierge/addresses.json
```
Expected: `ONCHAIN EXECUTION COMPLETE`, JSON has all keys listed in Interfaces.

- [ ] **Step 3: Run `forge test`** — still all green (script compiles with suite).

- [ ] **Step 4: Commit**

```bash
git add contracts/script/DeployConciergeDemo.s.sol contracts/foundry.toml
git commit -m "feat: concierge demo deploy script"
```

---

### Task 6: Concierge libs — evidence, deciders, decode

**Files:**
- Create: `apps/concierge/package.json` (copy `apps/hook-demo/package.json`, name `concierge`)
- Create: `apps/concierge/lib/evidence.js`, `apps/concierge/lib/deciders.js`, `apps/concierge/lib/decode.js`
- Test: `apps/concierge/test/evidence.test.js`, `apps/concierge/test/deciders.test.js`, `apps/concierge/test/decode.test.js`

**Interfaces:**
- Produces:
  - `evidence.js`: `canonicalEvidence(decision) → string` (stable key order: `action, amount, category, confidence, rationale, ticketId, vendor`), `evidenceHash(decision) → 0x…` (keccak256 of canonical string).
  - `deciders.js`: `makeDecider(kind, opts) → async (ticket, context) => decision` where `ticket = {id, description, vendor, amount (bigint), category}`, `context = {perTxCap (bigint), casaBudget (bigint)}`, `decision = {action: 'pay'|'propose'|'reject', rationale: string, confidence: number}`. Kinds: `mock` (rules below), `openai` (POST `${opts.baseUrl}/chat/completions`, model `opts.model`, parses strict-JSON reply, falls back to mock on any error), `zerog` (stub: every method throws `Error('TODO(event): 0G broker …exact call…')` and module doc-comments name `@0gfoundation/0g-compute-ts-sdk` acknowledge/ledger/inference calls).
  - Mock rules: category ∉ {plumbing, electrical, cleaning, admin} → reject; else amount ≤ perTxCap && amount ≤ casaBudget → pay; else → propose. Rationale strings must state the comparison used.
  - `decode.js`: same as hook-demo's but decoding `NotAuthorized(address,bytes32)` and `NotCompliant(address,bytes32)` (try both), export `decodeRefusal(errOrHex) → {wallet, reason} | null`.

- [ ] **Step 1: Write failing tests** (all three files; key cases — mock decider table:)

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDecider } from '../lib/deciders.js';

const ctx = { perTxCap: 200n * 10n ** 18n, casaBudget: 500n * 10n ** 18n };
const t = (amount, category = 'plumbing') =>
  ({ id: 1, description: 'x', vendor: 'plumber', amount: BigInt(amount) * 10n ** 18n, category });

test('mock decider pays routine under caps', async () => {
  const d = await makeDecider('mock')(t(120), ctx);
  assert.equal(d.action, 'pay');
  assert.ok(d.rationale.length > 0);
});

test('mock decider proposes above per-tx cap', async () => {
  assert.equal((await makeDecider('mock')(t(4500), ctx)).action, 'propose');
});

test('mock decider proposes above remaining budget', async () => {
  const d = await makeDecider('mock')(t(150), { ...ctx, casaBudget: 100n * 10n ** 18n });
  assert.equal(d.action, 'propose');
});

test('mock decider rejects unknown category', async () => {
  assert.equal((await makeDecider('mock')(t(10, 'jewelry'), ctx)).action, 'reject');
});

test('zerog decider is an explicit event-time stub', async () => {
  await assert.rejects(() => makeDecider('zerog')(t(10), ctx), /TODO\(event\)/);
});
```

evidence.test.js: same decision object with keys in two different orders hashes identically; hash differs when any field changes; hash matches `keccak256(toHex(canonicalEvidence(d)))` from viem. decode.test.js: mirror hook-demo's decode tests with `NotAuthorized` + `stringToHex('OVER_PER_TX_CAP', {size:32})`.

- [ ] **Step 2: Run to verify failure** — `cd apps/concierge && npm install && npm test` → module-not-found failures.

- [ ] **Step 3: Implement the three libs** (evidence via `Object.keys(...).sort()` + `JSON.stringify`; deciders per the rules table; decode by copying hook-demo's structure with both error ABIs).

- [ ] **Step 4: `npm test`** — all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/concierge/package.json apps/concierge/package-lock.json apps/concierge/lib apps/concierge/test
git commit -m "feat: concierge decision libs"
```

---

### Task 7: x402 vendor + client

**Files:**
- Create: `apps/concierge/vendor/server.js`, `apps/concierge/lib/x402.js`
- Test: `apps/concierge/test/x402.test.js`

**Interfaces:**
- Produces:
  - Vendor (`createVendorServer({port, vendorAddress, tokenAddress, rpcUrl}) → http.Server` exported for tests; `node vendor/server.js` starts standalone on `PORT_VENDOR ?? 4191`):
    - `POST /invoice {jobId, amount}` with no `X-PAYMENT` header → **402** `{x402Version: 1, accepts: [{scheme: 'exact', network: 'eip155-local', asset: tokenAddress, amount, payTo: vendorAddress}]}`.
    - Same request with `X-PAYMENT: {"txHash": "0x…"}` → verifies via RPC that the tx contains an ERC-20 `Transfer` of ≥ amount to `payTo`, then **200** `{paid: true, jobId}`; unverifiable → 402 again.
  - Client (`x402.js`): `settleInvoice({vendorUrl, jobId, amount, payFn}) → {paid, txHash}` — POSTs, on 402 reads `accepts[0]`, calls `await payFn(accepts[0])` (returns txHash), retries with the header. `payFn` is injected so tests need no chain.
- Consumes: nothing on-chain directly (the runtime supplies `payFn`).

- [ ] **Step 1: Failing test** — spin the vendor server in-process on an ephemeral port with a stubbed verifier (`createVendorServer({verify: async () => true})` — include a `verify` override in opts for tests); assert: first call yields 402 with `accepts[0].payTo`; `settleInvoice` with `payFn: async () => '0xabc'` returns `{paid: true}` and `payFn` received the accepts entry.

- [ ] **Step 2: Run — fails (modules missing).**

- [ ] **Step 3: Implement both files.** Vendor default verifier: `publicClient.getTransactionReceipt`, find log `address == asset && topics[0] == Transfer && topics[2] == pad(payTo)` and `BigInt(data) >= BigInt(amount)`.

- [ ] **Step 4: `npm test` — pass.**

- [ ] **Step 5: Commit** — `git add apps/concierge/vendor apps/concierge/lib/x402.js apps/concierge/test/x402.test.js && git commit -m "feat: x402 vendor and client"`

---

### Task 8: Concierge runtime + demo UI

**Files:**
- Create: `apps/concierge/server.js`, `apps/concierge/index.html`, `apps/concierge/env.example`

**Interfaces:**
- Consumes: `addresses.json` (Task 5 shape), all Task 6/7 libs, ABIs copyable from `apps/hook-demo/server.js` (registry/passport/gate/swap router/liquidity router/ERC-20) plus treasury ABI fragments: `proposePayment(address,uint256,bytes32) returns uint256`, `approvePayment(uint256)`, `executePayment(uint256)`, `payments(uint256) view returns (address,uint256,bytes32,uint256,bool)`, `fundConcierge(uint256)`, `revokeMandate()`, `grantMandate(address,uint256,uint64)`, `isAgentInGoodStanding(address) view returns (bool,bytes32)`, `agentPerTxCap() view returns (uint256)`, `HOUSE_TOKEN() view returns (address)`.
- Boot: same self-healing pattern as hook-demo (anvil spawn, CREATE2 re-etch, `DeployConciergeDemo` if `treasury` code missing, `.env` via `parseEnvFile`, forge gets `env: ENV`). `DECIDER=mock|openai|zerog` selects the decision adapter; vendor server spawned in-process (imported and started on boot).
- Chain reads live in one clearly-marked `// --- chain data (swap for subgraph adapter at the event) ---` section of server.js — this is the spec's ChainData boundary for the Graph continuity upgrade; keep every `readContract`/`getLogs` inside it.
- API:
  - `GET /api/state` — house (treasury mUSD, pool CASA+mUSD depth via position aggregation copied from hook-demo `positions.js` — copy that lib file too, it is chain-generic), agent (CASA budget, mUSD balance, standing + reason, perTxCap), owners (name, compliance), tickets (in-memory array with decisions + tx hashes), pending payments (id, vendor, amount, approvals, executed), `local`, `explorer`, `warped`.
  - `POST /api/ticket {description, amount, category}` — full rail-1/rail-2 pipeline: decide → `pay`: swap CASA→mUSD via `PoolSwapTest` (hookData = concierge addr, `amountSpecified: -amount`), then `settleInvoice` against the vendor with `payFn` doing an ERC-20 transfer from the concierge wallet; `propose`: `treasury.proposePayment(vendor, amount, evidenceHash)`; `reject`: record only. Response includes decision, evidenceHash, txHashes, refusal reason on revert (via `decodeRefusal`).
  - `POST /api/approve {owner, id}` (owner ∈ {operator, ana}) → `approvePayment`; auto-`executePayment` when threshold reached (report both hashes).
  - `POST /api/fund {amount}`, `POST /api/revoke-mandate`, `POST /api/grant-mandate` (restore: concierge, 200 ether, +365d), `POST /api/revoke-owner-kyc {owner}` + `POST /api/restore-owner-kyc {owner}` (operator signs registry.revokeClaim/submitClaim + syncPassport — copy hook-demo's doRevokeClaim/doVerify), `POST /api/timewarp`, `POST /api/reset` (local-only, as hook-demo), `GET /api/tx/<hash>` (inspector — copy from hook-demo, add treasury events `MandateGranted/MandateRevoked/ConciergeFunded/PaymentProposed/PaymentApproved/PaymentExecuted` to `INSPECTOR_EVENTS`).
- UI (`index.html`): PassportCreds branding copied from hook-demo. Panels: Casa Azul header (treasury mUSD, pool depth, chain chip, warp chip); agent card (standing pill + reason, CASA budget, mUSD, perTxCap); owners row (compliance pills, per-owner Revoke/Restore KYC buttons); ticket composer (description, amount, category select, submit) + preset buttons "Leaky faucet €120" and "Roof repair €4500"; ticket feed (decision, rationale, evidenceHash short, tx links); approval queue (pending payments + per-owner Approve buttons); world bar (Fund +500 CASA, Revoke/Grant mandate, ⏩ 1 year, ↺ Reset); on-chain log + tx inspector drawer (copied).
- `env.example`: copy hook-demo's and add `CONCIERGE_PK`, `PLUMBER_PK`, `DECIDER=mock`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `ZEROG_*` placeholders, `PORT=4190`, `PORT_VENDOR=4191`.

- [ ] **Step 1: Implement server.js** (largest file; copy hook-demo server section-by-section and adapt — config, ABIs, boot, ops, http). **Step 2: Implement index.html.** **Step 3: `npm test` still green; boot `node server.js`; `curl /api/state`** shows agent standing ok, budget 500, treasury 50,000.

- [ ] **Step 4: Commit** — `git add apps/concierge && git commit -m "feat: concierge runtime and demo"`

---

### Task 9: End-to-end verification

- [ ] **Step 1: Scripted beats via curl** (each asserts on the JSON):
  1. `POST /api/ticket {"description":"leaky faucet","amount":"120","category":"plumbing"}` → `decision.action == "pay"`, swap + vendor settlement hashes present, agent mUSD up ~0, CASA down 120.
  2. `POST /api/ticket {"description":"roof","amount":"4500","category":"plumbing"}` → `action == "propose"`, pending payment id 1.
  3. `POST /api/approve {"owner":"operator","id":1}` → approvals 1; `{"owner":"ana","id":1}` → executed, plumber mUSD +4500.
  4. `POST /api/revoke-owner-kyc {"owner":"ana"}` then ticket €50 → refusal `OWNER_NOT_COMPLIANT` (rail 1) AND propose also refused (`NotAgent`). Restore → €50 pays.
  5. Ticket €10 x N until CASA < 10 → `propose` (budget exhausted path) — or `POST /api/ticket {"amount":"600"}` (> budget 500) → propose.
  6. `POST /api/revoke-mandate` → ticket refused `MANDATE_REVOKED`; `grant-mandate` restores.
  7. `GET /api/tx/<payment hash>` → decoded `PaymentExecuted`.
- [ ] **Step 2: Browser check** (playwright): load page, submit preset ticket, verify log line + standing pill, screenshot.
- [ ] **Step 3: Full suites one more time:** `cd contracts && forge test` and `cd apps/concierge && npm test` and `cd apps/hook-demo && npm test`.
- [ ] **Step 4: Fix anything found; commit fixes individually** (`fix: …`).

---

### Task 10: Documentation

**Files:**
- Create: `apps/concierge/README.md` — mirror hook-demo README structure: what it is (two rails table), run (`npm install && npm start` → :4190), actors table (operator/ana owners, concierge, plumber), demo script (the beats from Task 9), API table, Sepolia section (env vars incl. `CONCIERGE_PK`/`PLUMBER_PK`, deploy command with `DeployConciergeDemo`), `DECIDER` modes incl. 0G event-time note.
- Modify: `README.md` — add `agents/HouseToken.sol`, `agents/HouseTreasury.sol`, `hooks/MandateHook.sol` rows to the contracts table + a "House Concierge Agent" subsection (thesis sentence, `make concierge-demo`, tests pointer, spec pointer).
- Modify: `CLAUDE.md` — agents layer paragraph (contracts, standing rule, adapter pattern, demo port).
- Modify: `Makefile` — target `concierge-demo:` `@cd apps/concierge && npm install --no-fund --no-audit && npm start`.
- Modify: `WHATS-NEW.md` — dated entry listing the concierge work (continuity-judging evidence).
- Modify: `docs/specs/agent-concierge-spec.md` — add `> **Status: implemented**` block noting any design deltas found during implementation.

- [ ] **Step 1: Write all six.** **Step 2: Commit** — `git add -A apps/concierge/README.md README.md CLAUDE.md Makefile WHATS-NEW.md docs/specs/agent-concierge-spec.md && git commit -m "docs: concierge agent"`  (note: CLAUDE.md is globally gitignored on this machine — `git add` will skip it; that is expected, edit it anyway for local use.)

- [ ] **Step 3: Push branch** — `git push https://github.com/luizoamorim/passportkit.git feat/concierge`. Do **not** open a PR yet: it would include the hook commits until PR #1 merges — flag to the team instead.
