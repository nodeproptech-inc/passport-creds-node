// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {DemoPositionRouter} from "../src/demo/DemoPositionRouter.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {ClaimIssuer} from "../src/ClaimIssuer.sol";
import {IdentityFactory} from "../src/IdentityFactory.sol";
import {Identity} from "../src/Identity.sol";
import {EligibilityGate} from "../src/EligibilityGate.sol";
import {ClaimTopics} from "../src/libraries/Types.sol";
import {ComplianceHook, IEligibilityGate, IIdentityResolver} from "../src/hooks/ComplianceHook.sol";

/**
 * @title DeployHookDemo
 * @notice Deploys the full ComplianceHook demo world:
 *         PassportKit stack (IssuerRegistry → ClaimIssuer → IdentityFactory → EligibilityGate)
 *         → v4 PoolManager + routers → two gated pools (policy 1 Deal Room, policy 2 Investor)
 *         with liquidity → funded actors. Writes every address to apps/hook-demo/addresses.json.
 *
 * The operator plays every platform role here: admin, issuer signer (EIP-712) and LP.
 * Claims follow Model B — the operator SIGNS off-chain, the holder SUBMITS from their own wallet.
 *
 * Local anvil (dev accounts #0 operator, #1 ana, #2 rui — no env needed):
 *   forge script script/DeployHookDemo.s.sol --rpc-url http://localhost:8545 --broadcast
 *
 * Testnet (e.g. Ethereum Sepolia — set env, see apps/hook-demo/.env.example):
 *   OPERATOR_PK / ANA_PK / RUI_PK  — funded private keys (operator pays deploys)
 *   POOL_MANAGER                   — canonical v4 PoolManager (skips local deploy)
 *   forge script script/DeployHookDemo.s.sol --rpc-url $RPC_URL --broadcast
 */
contract DeployHookDemo is Script {
    uint256 constant ANVIL_OPERATOR_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant ANVIL_ANA_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant ANVIL_RUI_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    /// Policy ids are repo-wide constants (see apps/api/.env.example)
    uint256 constant POLICY_DEAL_ROOM = 1; // [KYC_VERIFIED]
    uint256 constant POLICY_INVESTOR = 2; // [KYC_VERIFIED, ACCREDITED_INVESTOR]

    uint256 OPERATOR_PK;
    uint256 ANA_PK;
    uint256 RUI_PK;

    IssuerRegistry issuerRegistry;
    ClaimIssuer claimIssuer;
    IdentityFactory identityFactory;
    EligibilityGate eligibilityGate;
    PoolManager poolManager;
    PoolSwapTest swapRouter;
    DemoPositionRouter liquidityRouter;
    MockERC20 token0;
    MockERC20 token1;
    ComplianceHook dealHook;
    ComplianceHook investorHook;

    address operator;
    address ana;
    address rui;
    address operatorIdentity;
    address anaIdentity;
    address ruiIdentity;
    uint256 nonce;

    function run() external {
        OPERATOR_PK = vm.envOr("OPERATOR_PK", ANVIL_OPERATOR_PK);
        ANA_PK = vm.envOr("ANA_PK", ANVIL_ANA_PK);
        RUI_PK = vm.envOr("RUI_PK", ANVIL_RUI_PK);
        if (block.chainid != 31337) {
            require(OPERATOR_PK != ANVIL_OPERATOR_PK, "set OPERATOR_PK / ANA_PK / RUI_PK for non-local chains");
        }

        operator = vm.addr(OPERATOR_PK);
        ana = vm.addr(ANA_PK);
        rui = vm.addr(RUI_PK);

        vm.startBroadcast(OPERATOR_PK);
        _deployStack();
        _onboardActors();
        _deployHooksAndPools();
        vm.stopBroadcast();

        // Model B: ana submits her own signed claim from her own wallet
        _submitClaim(ANA_PK, anaIdentity, ClaimTopics.KYC_VERIFIED);

        _fundActor(ANA_PK);
        _fundActor(RUI_PK);

        _writeAddresses();

        console.log("IssuerRegistry:     ", address(issuerRegistry));
        console.log("ClaimIssuer:        ", address(claimIssuer));
        console.log("IdentityFactory:    ", address(identityFactory));
        console.log("EligibilityGate:    ", address(eligibilityGate));
        console.log("PoolManager:        ", address(poolManager));
        console.log("Deal hook:          ", address(dealHook));
        console.log("Investor hook:      ", address(investorHook));
    }

    function _deployStack() internal {
        issuerRegistry = new IssuerRegistry(operator);
        claimIssuer = new ClaimIssuer(operator, operator); // the operator key is the EIP-712 signer
        identityFactory = new IdentityFactory(operator, address(issuerRegistry));
        eligibilityGate = new EligibilityGate(operator, address(issuerRegistry));

        issuerRegistry.setTrusted(address(claimIssuer), ClaimTopics.KYC_VERIFIED, true);
        issuerRegistry.setTrusted(address(claimIssuer), ClaimTopics.ACCREDITED_INVESTOR, true);

        uint256[] memory dealTopics = new uint256[](1);
        dealTopics[0] = ClaimTopics.KYC_VERIFIED;
        eligibilityGate.setPolicy(POLICY_DEAL_ROOM, dealTopics);

        uint256[] memory investorTopics = new uint256[](2);
        investorTopics[0] = ClaimTopics.KYC_VERIFIED;
        investorTopics[1] = ClaimTopics.ACCREDITED_INVESTOR;
        eligibilityGate.setPolicy(POLICY_INVESTOR, investorTopics);

        address existingPoolManager = vm.envOr("POOL_MANAGER", address(0));
        poolManager = existingPoolManager != address(0)
            ? PoolManager(existingPoolManager)
            : new PoolManager(operator);
        swapRouter = new PoolSwapTest(poolManager);
        liquidityRouter = new DemoPositionRouter(poolManager);

        MockERC20 tokenA = new MockERC20("Property Share", "PROP", 18);
        MockERC20 tokenB = new MockERC20("Mock USD", "mUSD", 18);
        (token0, token1) = address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);

        token0.mint(operator, 1_000_000 ether);
        token1.mint(operator, 1_000_000 ether);
        token0.approve(address(swapRouter), type(uint256).max);
        token1.approve(address(swapRouter), type(uint256).max);
        token0.approve(address(liquidityRouter), type(uint256).max);
        token1.approve(address(liquidityRouter), type(uint256).max);
    }

    /// One identity per actor; the operator also clears both policies so it can seed liquidity.
    /// Ana starts with an identity and no claims (verified live in the demo), Rui with neither.
    function _onboardActors() internal {
        operatorIdentity = identityFactory.createIdentity(operator);
        anaIdentity = identityFactory.createIdentity(ana);
        ruiIdentity = identityFactory.createIdentity(rui);

        _signAndSubmit(operatorIdentity, ClaimTopics.KYC_VERIFIED);
        _signAndSubmit(operatorIdentity, ClaimTopics.ACCREDITED_INVESTOR);
    }

    /// Signs (issuer) and submits (holder) in one call — only valid while broadcasting as the holder.
    function _signAndSubmit(address identity, uint256 topic) internal {
        (bytes memory sig, bytes memory data) = _signClaim(identity, topic);
        Identity(identity).submitClaim(topic, address(claimIssuer), sig, data);
    }

    function _submitClaim(uint256 holderPk, address identity, uint256 topic) internal {
        (bytes memory sig, bytes memory data) = _signClaim(identity, topic);
        vm.startBroadcast(holderPk);
        Identity(identity).submitClaim(topic, address(claimIssuer), sig, data);
        vm.stopBroadcast();
    }

    /// EIP-712 "Claim" signed by the issuer signer (the operator key). Zero PII: only a hash.
    function _signClaim(address identity, uint256 topic)
        internal
        returns (bytes memory sig, bytes memory data)
    {
        uint64 expiresAt = uint64(block.timestamp + 365 days);
        bytes32 dataHash = keccak256(abi.encode("demo-attest", nonce));
        bytes32 claimNonce = keccak256(abi.encode("demo-session", nonce++));
        data = abi.encode(dataHash, expiresAt, claimNonce);

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
                address(claimIssuer)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(OPERATOR_PK, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        sig = abi.encodePacked(r, s, v);
    }

    function _deployHooksAndPools() internal {
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);

        dealHook = _deployHook(flags, POLICY_DEAL_ROOM);
        investorHook = _deployHook(flags, POLICY_INVESTOR);

        _createPool(dealHook);
        _createPool(investorHook);
    }

    function _deployHook(uint160 flags, uint256 policyId) internal returns (ComplianceHook hook) {
        bytes memory args = abi.encode(poolManager, eligibilityGate, identityFactory, policyId);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, flags, type(ComplianceHook).creationCode, args);
        hook = new ComplianceHook{ salt: salt }(
            poolManager,
            IEligibilityGate(address(eligibilityGate)),
            IIdentityResolver(address(identityFactory)),
            policyId
        );
        require(address(hook) == hookAddress, "hook address mismatch");
    }

    function _createPool(ComplianceHook hook) internal {
        PoolKey memory key = _poolKey(hook);
        poolManager.initialize(key, 79228162514264337593543950336); // price 1:1
        liquidityRouter.modifyLiquidity(
            key, TickMath.minUsableTick(60), TickMath.maxUsableTick(60), 10_000e18, abi.encode(operator)
        );
    }

    function _poolKey(ComplianceHook hook) internal view returns (PoolKey memory) {
        return PoolKey(
            Currency.wrap(address(token0)), Currency.wrap(address(token1)), 3000, 60, IHooks(address(hook))
        );
    }

    function _fundActor(uint256 pk) internal {
        address wallet = vm.addr(pk);
        vm.startBroadcast(OPERATOR_PK);
        token0.mint(wallet, 1_000 ether);
        token1.mint(wallet, 1_000 ether);
        vm.stopBroadcast();

        vm.startBroadcast(pk);
        token0.approve(address(swapRouter), type(uint256).max);
        token1.approve(address(swapRouter), type(uint256).max);
        token0.approve(address(liquidityRouter), type(uint256).max);
        token1.approve(address(liquidityRouter), type(uint256).max);
        vm.stopBroadcast();
    }

    function _writeAddresses() internal {
        string memory json = string.concat(
            '{\n',
            '  "chainId": ', vm.toString(block.chainid), ',\n',
            '  "deployBlock": ', vm.toString(block.number), ',\n',
            '  "issuerRegistry": "', vm.toString(address(issuerRegistry)), '",\n',
            '  "claimIssuer": "', vm.toString(address(claimIssuer)), '",\n',
            '  "identityFactory": "', vm.toString(address(identityFactory)), '",\n',
            '  "eligibilityGate": "', vm.toString(address(eligibilityGate)), '",\n',
            '  "poolManager": "', vm.toString(address(poolManager)), '",\n',
            '  "swapRouter": "', vm.toString(address(swapRouter)), '",\n',
            '  "liquidityRouter": "', vm.toString(address(liquidityRouter)), '",\n'
        );
        json = string.concat(
            json,
            '  "token0": "', vm.toString(address(token0)), '",\n',
            '  "token0Symbol": "', token0.symbol(), '",\n',
            '  "token1": "', vm.toString(address(token1)), '",\n',
            '  "token1Symbol": "', token1.symbol(), '",\n',
            '  "dealHook": "', vm.toString(address(dealHook)), '",\n',
            '  "investorHook": "', vm.toString(address(investorHook)), '",\n',
            '  "fee": 3000,\n',
            '  "tickSpacing": 60,\n'
        );
        json = string.concat(
            json,
            '  "policies": {\n',
            '    "deal": ', vm.toString(POLICY_DEAL_ROOM), ',\n',
            '    "investor": ', vm.toString(POLICY_INVESTOR), '\n',
            '  },\n',
            '  "actors": {\n',
            '    "operator": "', vm.toString(operator), '",\n',
            '    "ana": "', vm.toString(ana), '",\n',
            '    "rui": "', vm.toString(rui), '"\n',
            '  },\n',
            '  "identities": {\n',
            '    "operator": "', vm.toString(operatorIdentity), '",\n',
            '    "ana": "', vm.toString(anaIdentity), '",\n',
            '    "rui": "', vm.toString(ruiIdentity), '"\n',
            '  }\n',
            '}\n'
        );
        vm.writeFile("../apps/hook-demo/addresses.json", json);
    }
}
