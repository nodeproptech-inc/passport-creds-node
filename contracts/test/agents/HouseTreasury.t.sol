// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {IssuerRegistry} from "../../src/IssuerRegistry.sol";
import {ClaimIssuer} from "../../src/ClaimIssuer.sol";
import {IdentityFactory} from "../../src/IdentityFactory.sol";
import {Identity} from "../../src/Identity.sol";
import {EligibilityGate} from "../../src/EligibilityGate.sol";
import {ClaimTopics} from "../../src/libraries/Types.sol";
import {HouseTreasury, IEligibilityGate, IIdentityResolver} from "../../src/agents/HouseTreasury.sol";

/**
 * HouseTreasury against the REAL PassportKit stack (IssuerRegistry + ClaimIssuer +
 * IdentityFactory + Identity + EligibilityGate) — no mocks, same wiring as Flow.t.sol
 * and ComplianceHook.t.sol.
 *
 * The house's owner policy is POLICY_DEAL_ROOM = 1 ([KYC_VERIFIED]), repo-wide.
 * Owner compliance is the agent's root of authority: the issuer flipping one owner's
 * revocation latch is the kill switch for everything the concierge can do.
 *
 * ⚠ forge 1.7.1: never put an external call between `vm.expectRevert` and the guarded
 *   call — the cheatcode binds to the FIRST call that follows it.
 */
contract HouseTreasuryTest is Test {
    uint256 constant POLICY_DEAL_ROOM = 1; // [KYC_VERIFIED]

    IssuerRegistry issuerRegistry;
    ClaimIssuer issuer;
    IdentityFactory factory;
    EligibilityGate gate;
    MockERC20 musd;
    HouseTreasury treasury;

    address admin = makeAddr("admin");
    uint256 signerPk = uint256(keccak256("issuer-signer"));
    address signer;
    address ownerA = makeAddr("ownerA");
    address ownerB = makeAddr("ownerB");
    address concierge = makeAddr("concierge");
    address stranger = makeAddr("stranger");

    uint256 KYC = ClaimTopics.KYC_VERIFIED;
    uint64 FUTURE;
    uint256 nonce;

    function setUp() public {
        FUTURE = uint64(block.timestamp + 365 days);
        signer = vm.addr(signerPk);

        // --- PassportKit stack (the real contracts) ---
        issuerRegistry = new IssuerRegistry(admin);
        issuer = new ClaimIssuer(admin, signer);
        factory = new IdentityFactory(admin, address(issuerRegistry));
        gate = new EligibilityGate(admin, address(issuerRegistry));

        vm.startPrank(admin);
        issuerRegistry.setTrusted(address(issuer), KYC, true);
        uint256[] memory dealTopics = new uint256[](1);
        dealTopics[0] = KYC;
        gate.setPolicy(POLICY_DEAL_ROOM, dealTopics);
        vm.stopPrank();

        // Both house owners clear the policy; the concierge holds no claims of its own
        _onboard(ownerA);
        _onboard(ownerB);
        _issue(ownerA, KYC, FUTURE);
        _issue(ownerB, KYC, FUTURE);

        musd = new MockERC20("Mock USD", "mUSD", 18);
        address[] memory owners = new address[](2);
        owners[0] = ownerA;
        owners[1] = ownerB;
        treasury = _newTreasury(owners, 2);
    }

    // --- helpers ---

    function _newTreasury(address[] memory owners_, uint256 threshold) internal returns (HouseTreasury) {
        return new HouseTreasury(
            owners_,
            threshold,
            IERC20(address(musd)),
            IEligibilityGate(address(gate)),
            IIdentityResolver(address(factory)),
            POLICY_DEAL_ROOM,
            "Casa Azul Scrip",
            "CASA"
        );
    }

    /// One Identity per wallet, minted by the backend role (AGENT_ROLE = admin here).
    function _onboard(address wallet) internal returns (address identity) {
        vm.prank(admin);
        identity = factory.createIdentity(wallet);
    }

    /// Model B: the issuer SIGNS off-chain (EIP-712), the holder submits from their own wallet.
    function _issue(address wallet, uint256 topic, uint64 expiresAt) internal {
        address identity = factory.identityOfWallet(wallet);
        bytes32 dataHash = keccak256(abi.encode("sanitized-result", nonce));
        bytes32 claimNonce = keccak256(abi.encode("session", nonce++));
        bytes memory data = abi.encode(dataHash, expiresAt, claimNonce);
        bytes memory sig = _sign(identity, topic, dataHash, expiresAt, claimNonce);

        vm.prank(wallet);
        Identity(identity).submitClaim(topic, address(issuer), sig, data);
    }

    function _sign(address identity, uint256 topic, bytes32 dataHash, uint64 expiresAt, bytes32 claimNonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 typeHash = keccak256(
            "Claim(address identity,uint256 topic,bytes32 dataHash,uint64 expiresAt,bytes32 nonce)"
        );
        bytes32 structHash = keccak256(abi.encode(typeHash, identity, topic, dataHash, expiresAt, claimNonce));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("PassportKitClaim"),
                keccak256("1"),
                block.chainid,
                address(issuer)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(signerPk, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    /// The kill switch: the issuer's per-user latch, re-read by the gate on every call.
    function _setRevoked(address wallet, uint256 topic, bool value) internal {
        address identity = factory.identityOfWallet(wallet); // resolve first: vm.prank hits the NEXT call
        vm.prank(admin);
        issuer.setRevoked(identity, topic, value);
    }

    function _grant() internal {
        vm.prank(ownerA);
        treasury.grantMandate(concierge, 200 ether, FUTURE);
    }

    // --- construction ---

    function test_constructor_rejects_duplicate_owners() public {
        address[] memory dupes = new address[](2);
        dupes[0] = ownerA;
        dupes[1] = ownerA; // passes the length check, but can only ever approve once
        vm.expectRevert(HouseTreasury.DuplicateOwner.selector);
        _newTreasury(dupes, 2);
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
        _setRevoked(ownerB, KYC, true); // one owner loses compliance
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

    function test_reclaim_budget_emits_event() public {
        _grant();
        vm.startPrank(ownerA);
        treasury.fundConcierge(50 ether);
        vm.expectEmit(true, false, false, true);
        emit HouseTreasury.BudgetReclaimed(concierge, 20 ether);
        treasury.reclaimBudget(20 ether);
        vm.stopPrank();
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
        assertFalse(treasury.isCompliantOwner(stranger)); // not an owner, and no identity either
        _setRevoked(ownerA, KYC, true);
        assertFalse(treasury.isCompliantOwner(ownerA));
    }

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

    function test_propose_rejects_zero_amount() public {
        _grant();
        vm.prank(concierge);
        vm.expectRevert(HouseTreasury.ZeroAmount.selector);
        treasury.proposePayment(stranger, 0, keccak256("e"));
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

    function test_non_compliant_owner_cannot_approve() public {
        _grant();
        _fundTreasury(1_000 ether);
        vm.prank(concierge);
        uint256 id = treasury.proposePayment(stranger, 100 ether, keccak256("e"));
        _setRevoked(ownerB, KYC, true); // queued payment, owner loses compliance after
        vm.prank(ownerB);
        vm.expectRevert(HouseTreasury.NotCompliantOwner.selector);
        treasury.approvePayment(id);
    }

    function test_non_owner_cannot_approve() public {
        _grant();
        vm.prank(concierge);
        uint256 id = treasury.proposePayment(stranger, 100 ether, keccak256("e"));
        vm.prank(stranger);
        vm.expectRevert(HouseTreasury.NotOwner.selector);
        treasury.approvePayment(id);
    }

    function test_kill_switch_blocks_new_proposals() public {
        _grant();
        _setRevoked(ownerA, KYC, true);
        vm.prank(concierge);
        vm.expectRevert(HouseTreasury.NotAgent.selector);
        treasury.proposePayment(stranger, 1 ether, keccak256("e"));
    }
}
