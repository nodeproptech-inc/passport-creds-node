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

import {IssuerRegistry} from "../../src/IssuerRegistry.sol";
import {ClaimIssuer} from "../../src/ClaimIssuer.sol";
import {IdentityFactory} from "../../src/IdentityFactory.sol";
import {Identity} from "../../src/Identity.sol";
import {EligibilityGate} from "../../src/EligibilityGate.sol";
import {ClaimTopics} from "../../src/libraries/Types.sol";
import {HouseTreasury, IEligibilityGate, IIdentityResolver} from "../../src/agents/HouseTreasury.sol";
import {MandateHook} from "../../src/hooks/MandateHook.sol";
import {DemoPositionRouter} from "../../src/demo/DemoPositionRouter.sol";

/**
 * MandateHook against the REAL PassportKit stack behind the treasury — the hook itself
 * is unchanged (it reads HouseTreasury through IHouseTreasuryStanding), so these tests
 * prove the new eligibility wiring reaches the pool untouched.
 *
 * ⚠ forge 1.7.1: never put an external call between `vm.expectRevert` and the guarded
 *   call — the cheatcode binds to the FIRST call that follows it.
 */
contract MandateHookTest is Test {
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    uint256 constant POLICY_DEAL_ROOM = 1; // [KYC_VERIFIED]

    IssuerRegistry issuerRegistry;
    ClaimIssuer issuer;
    IdentityFactory factory;
    EligibilityGate gate;
    HouseTreasury treasury;
    MockERC20 musd;

    PoolManager poolManager;
    PoolSwapTest swapRouter;
    DemoPositionRouter liquidityRouter;
    MandateHook hook;
    PoolKey poolKey;
    bool casaIsToken0;

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

        _onboard(ownerA);
        _onboard(ownerB);
        _issue(ownerA, KYC, FUTURE);
        _issue(ownerB, KYC, FUTURE);

        musd = new MockERC20("Mock USD", "mUSD", 18);
        address[] memory owners = new address[](2);
        owners[0] = ownerA;
        owners[1] = ownerB;
        treasury = new HouseTreasury(
            owners,
            2,
            IERC20(address(musd)),
            IEligibilityGate(address(gate)),
            IIdentityResolver(address(factory)),
            POLICY_DEAL_ROOM,
            "Casa",
            "CASA"
        );
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
        casaIsToken0 = t0 == casaAddr;

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

    // --- helpers ---

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

    /// @dev Sells CASA for mUSD as `who`, announcing `who` through hookData. Kept free of
    ///      any external call before the swap so `vm.expectRevert` binds to the swap itself.
    function _swapAs(address who, int256 amountSpecified) internal {
        vm.prank(who);
        swapRouter.swap(
            poolKey,
            SwapParams({
                zeroForOne: casaIsToken0,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: casaIsToken0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            abi.encode(who)
        );
    }

    function _swapAsConcierge(int256 amountSpecified) internal {
        _swapAs(concierge, amountSpecified);
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

    /// @notice A compliant owner takes the hook's fast path: no mandate needed, no cap applied.
    function test_compliant_owner_can_swap() public {
        vm.startPrank(ownerA);
        treasury.HOUSE_TOKEN().approve(address(swapRouter), type(uint256).max);
        musd.approve(address(swapRouter), type(uint256).max);
        vm.stopPrank();

        uint256 before = musd.balanceOf(ownerA);
        _swapAs(ownerA, -10e18);
        assertGt(musd.balanceOf(ownerA), before);
    }

    function test_expired_mandate_blocks_agent_swap() public {
        vm.warp(uint256(FUTURE) + 1);
        _expectNotAuthorized(IHooks.beforeSwap.selector, concierge, "MANDATE_EXPIRED");
        _swapAsConcierge(-1e18);
    }

    function test_stranger_cannot_swap() public {
        _expectNotAuthorized(IHooks.beforeSwap.selector, stranger, "NO_MANDATE");
        _swapAs(stranger, -1e18);
    }

    function test_owner_revocation_kills_agent_swaps() public {
        _setRevoked(ownerB, KYC, true);
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
        _setRevoked(ownerA, KYC, true);
        vm.prank(ownerA);
        liquidityRouter.modifyLiquidity(poolKey, -887220, 887220, -1_000e18, abi.encode(ownerA));
    }
}
