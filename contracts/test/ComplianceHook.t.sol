// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {IPoolManager, SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {ClaimIssuer} from "../src/ClaimIssuer.sol";
import {EligibilityGate} from "../src/EligibilityGate.sol";
import {IdentityFactory} from "../src/IdentityFactory.sol";
import {Identity} from "../src/Identity.sol";
import {ClaimTopics} from "../src/libraries/Types.sol";
import {ComplianceHook} from "../src/hooks/ComplianceHook.sol";

/**
 * Integration tests: ComplianceHook against the REAL PassportKit stack
 * (IssuerRegistry + ClaimIssuer + IdentityFactory + Identity + EligibilityGate),
 * on a real v4 PoolManager. No mocks anywhere — the same wiring as Flow.t.sol.
 *
 * Three pools:
 *   dealPool     — policy 1: [KYC_VERIFIED]
 *   investorPool — policy 2: [KYC_VERIFIED, ACCREDITED_INVESTOR]
 *   voidPool     — policy 99: never configured (fail-closed → NO_POLICY)
 */
contract ComplianceHookTest is Test {
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    uint256 constant POLICY_DEAL = 1;
    uint256 constant POLICY_INVESTOR = 2;
    uint256 constant POLICY_UNSET = 99;

    IssuerRegistry issuerRegistry;
    ClaimIssuer issuer;
    IdentityFactory factory;
    EligibilityGate gate;

    PoolManager poolManager;
    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest liquidityRouter;

    MockERC20 token0;
    MockERC20 token1;

    ComplianceHook dealHook;
    ComplianceHook investorHook;
    ComplianceHook voidHook;
    PoolKey dealPool;
    PoolKey investorPool;
    PoolKey voidPool;

    address admin = makeAddr("admin");
    uint256 signerPk = uint256(keccak256("issuer-signer"));
    address signer;
    address ana = makeAddr("ana"); // onboarded during the tests
    address rui = makeAddr("rui"); // never gets an identity

    uint256 KYC = ClaimTopics.KYC_VERIFIED;
    uint256 ACCREDITED = ClaimTopics.ACCREDITED_INVESTOR;
    uint64 FUTURE;
    uint256 nonce;

    int24 tickLower;
    int24 tickUpper;

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
        issuerRegistry.setTrusted(address(issuer), ACCREDITED, true);

        uint256[] memory dealTopics = new uint256[](1);
        dealTopics[0] = KYC;
        gate.setPolicy(POLICY_DEAL, dealTopics);

        uint256[] memory investorTopics = new uint256[](2);
        investorTopics[0] = KYC;
        investorTopics[1] = ACCREDITED;
        gate.setPolicy(POLICY_INVESTOR, investorTopics);
        vm.stopPrank();

        // The test contract acts as LP and must clear both policies to seed liquidity
        _onboard(address(this));
        _issue(address(this), KYC, FUTURE);
        _issue(address(this), ACCREDITED, FUTURE);

        // --- Uniswap v4 stack ---
        poolManager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(poolManager);
        liquidityRouter = new PoolModifyLiquidityTest(poolManager);

        MockERC20 tokenA = new MockERC20("Deal Token", "DEAL", 18);
        MockERC20 tokenB = new MockERC20("Quote Token", "QUOTE", 18);
        (token0, token1) = address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);
        token0.mint(address(this), 10_000 ether);
        token1.mint(address(this), 10_000 ether);
        token0.approve(address(swapRouter), type(uint256).max);
        token1.approve(address(swapRouter), type(uint256).max);
        token0.approve(address(liquidityRouter), type(uint256).max);
        token1.approve(address(liquidityRouter), type(uint256).max);

        // Hook addresses must encode the permissions; deployCodeTo skips mining in tests
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);
        dealHook = _deployHook(flags ^ (0x4444 << 144), POLICY_DEAL);
        investorHook = _deployHook(flags ^ (0x4445 << 144), POLICY_INVESTOR);
        voidHook = _deployHook(flags ^ (0x4446 << 144), POLICY_UNSET);

        tickLower = TickMath.minUsableTick(60);
        tickUpper = TickMath.maxUsableTick(60);

        dealPool = _createPool(dealHook);
        investorPool = _createPool(investorHook);
        voidPool = _initPool(voidHook); // nobody can seed a pool whose policy denies everyone
    }

    // --- helpers ---

    function _deployHook(uint160 target, uint256 policyId) internal returns (ComplianceHook hook) {
        hook = ComplianceHook(address(target));
        deployCodeTo(
            "ComplianceHook.sol:ComplianceHook",
            abi.encode(poolManager, gate, factory, policyId),
            address(hook)
        );
    }

    function _initPool(ComplianceHook hook) internal returns (PoolKey memory key) {
        key = PoolKey(
            Currency.wrap(address(token0)), Currency.wrap(address(token1)), 3000, 60, IHooks(address(hook))
        );
        poolManager.initialize(key, SQRT_PRICE_1_1);
    }

    function _createPool(ComplianceHook hook) internal returns (PoolKey memory key) {
        key = _initPool(hook);
        liquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: 1_000e18,
                salt: 0
            }),
            abi.encode(address(this))
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

    function _setRevoked(address wallet, uint256 topic, bool value) internal {
        address identity = factory.identityOfWallet(wallet); // resolve first: vm.prank hits the NEXT call
        vm.prank(admin);
        issuer.setRevoked(identity, topic, value);
    }

    function _swap(PoolKey memory key, bytes memory hookData) internal {
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -1e18,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            hookData
        );
    }

    function _addLiquidity(PoolKey memory key, bytes memory hookData) internal {
        liquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: 1e18,
                salt: 0
            }),
            hookData
        );
    }

    function _expectNotCompliant(ComplianceHook hook, bytes4 hookFn, address wallet, bytes32 reason) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                hookFn,
                abi.encodeWithSelector(ComplianceHook.NotCompliant.selector, wallet, reason),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }

    // --- swap gating ---

    function test_swap_blocked_when_no_identity() public {
        _expectNotCompliant(dealHook, IHooks.beforeSwap.selector, rui, "NO_IDENTITY");
        _swap(dealPool, abi.encode(rui));
    }

    function test_swap_blocked_when_identity_has_no_claim() public {
        _onboard(ana); // identity exists, but nothing was ever issued to it
        _expectNotCompliant(dealHook, IHooks.beforeSwap.selector, ana, "MISSING_KYC");
        _swap(dealPool, abi.encode(ana));
    }

    function test_swap_allowed_after_kyc_claim() public {
        _onboard(ana);
        _issue(ana, KYC, FUTURE);

        uint256 balanceBefore = token1.balanceOf(address(this));
        _swap(dealPool, abi.encode(ana));
        assertGt(token1.balanceOf(address(this)), balanceBefore);
    }

    /// THE MONEY MOMENT: the issuer flips the latch and the pool refuses the very next block.
    function test_swap_blocked_after_issuer_revokes_kyc() public {
        _onboard(ana);
        _issue(ana, KYC, FUTURE);
        _swap(dealPool, abi.encode(ana)); // trades fine…

        _setRevoked(ana, KYC, true); // …until the issuer revokes

        _expectNotCompliant(dealHook, IHooks.beforeSwap.selector, ana, "MISSING_KYC");
        _swap(dealPool, abi.encode(ana));
    }

    /// Re-verification is issuer-gated: only the issuer can re-open the latch.
    function test_swap_allowed_again_after_issuer_reopens() public {
        _onboard(ana);
        _issue(ana, KYC, FUTURE);
        _setRevoked(ana, KYC, true);
        _setRevoked(ana, KYC, false);

        uint256 balanceBefore = token1.balanceOf(address(this));
        _swap(dealPool, abi.encode(ana));
        assertGt(token1.balanceOf(address(this)), balanceBefore);
    }

    function test_swap_blocked_when_claim_expired() public {
        _onboard(ana);
        _issue(ana, KYC, uint64(block.timestamp + 30 days));
        _swap(dealPool, abi.encode(ana)); // valid today

        vm.warp(block.timestamp + 31 days);

        // the claim is still stored on the Identity — the issuer refuses it at read time
        _expectNotCompliant(dealHook, IHooks.beforeSwap.selector, ana, "MISSING_KYC");
        _swap(dealPool, abi.encode(ana));
    }

    /// Fail-closed: a pool pointed at a policy nobody configured lets nobody in.
    function test_swap_blocked_when_policy_unset() public {
        _expectNotCompliant(voidHook, IHooks.beforeSwap.selector, address(this), "NO_POLICY");
        _swap(voidPool, abi.encode(address(this)));
    }

    // --- investor pool policy ---

    function test_investor_pool_blocked_without_accreditation() public {
        _onboard(ana);
        _issue(ana, KYC, FUTURE);

        _expectNotCompliant(investorHook, IHooks.beforeSwap.selector, ana, "MISSING_ACCREDITED");
        _swap(investorPool, abi.encode(ana));
    }

    function test_investor_pool_allowed_after_accreditation() public {
        _onboard(ana);
        _issue(ana, KYC, FUTURE);
        _issue(ana, ACCREDITED, FUTURE);

        uint256 balanceBefore = token1.balanceOf(address(this));
        _swap(investorPool, abi.encode(ana));
        assertGt(token1.balanceOf(address(this)), balanceBefore);
    }

    // --- liquidity gating ---

    function test_addLiquidity_blocked_when_no_identity() public {
        _expectNotCompliant(dealHook, IHooks.beforeAddLiquidity.selector, rui, "NO_IDENTITY");
        _addLiquidity(dealPool, abi.encode(rui));
    }

    function test_addLiquidity_allowed_after_kyc_claim() public {
        _onboard(ana);
        _issue(ana, KYC, FUTURE);
        _addLiquidity(dealPool, abi.encode(ana));
    }

    function test_removeLiquidity_always_free() public {
        // the LP loses compliance entirely — exit must still work on both pools
        _setRevoked(address(this), KYC, true);
        _setRevoked(address(this), ACCREDITED, true);
        assertEq(dealHook.reasonFor(address(this)), bytes32("MISSING_KYC"));

        liquidityRouter.modifyLiquidity(
            dealPool,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: -100e18,
                salt: 0
            }),
            abi.encode(address(this))
        );
        liquidityRouter.modifyLiquidity(
            investorPool,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: -100e18,
                salt: 0
            }),
            abi.encode(address(this))
        );
    }

    // --- actor resolution ---

    function test_actor_falls_back_to_sender_without_hookData() public {
        // empty hookData → actor is the v4 sender, i.e. the router, which has no identity
        _expectNotCompliant(dealHook, IHooks.beforeSwap.selector, address(swapRouter), "NO_IDENTITY");
        _swap(dealPool, "");
    }

    function test_actor_from_hookData_overrides_sender() public {
        // make the router itself compliant: only the hookData actor may decide the outcome
        _onboard(address(swapRouter));
        _issue(address(swapRouter), KYC, FUTURE);
        _onboard(ana); // ana has an identity but no claims

        _expectNotCompliant(dealHook, IHooks.beforeSwap.selector, ana, "MISSING_KYC");
        _swap(dealPool, abi.encode(ana));
    }

    // --- reasonFor carries exactly what the reverts carry ---

    function test_reasonFor_matches_revert_reason() public {
        assertEq(dealHook.reasonFor(rui), bytes32("NO_IDENTITY"));

        _onboard(ana);
        assertEq(dealHook.reasonFor(ana), bytes32("MISSING_KYC"));

        _issue(ana, KYC, FUTURE);
        assertEq(dealHook.reasonFor(ana), bytes32(0)); // compliant → no reason
        assertEq(investorHook.reasonFor(ana), bytes32("MISSING_ACCREDITED"));
        assertEq(voidHook.reasonFor(ana), bytes32("NO_POLICY"));

        _setRevoked(ana, KYC, true);
        assertEq(dealHook.reasonFor(ana), bytes32("MISSING_KYC"));
    }
}
