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
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {ClaimIssuer} from "../src/ClaimIssuer.sol";
import {IdentityFactory} from "../src/IdentityFactory.sol";
import {Identity} from "../src/Identity.sol";
import {EligibilityGate} from "../src/EligibilityGate.sol";
import {ClaimTopics} from "../src/libraries/Types.sol";
import {HouseTreasury, IEligibilityGate, IIdentityResolver} from "../src/agents/HouseTreasury.sol";
import {HouseToken} from "../src/agents/HouseToken.sol";
import {MandateHook, IHouseTreasuryStanding} from "../src/hooks/MandateHook.sol";

/**
 * @title DeployConciergeDemo
 * @notice Deploys the full House Concierge Agent demo world:
 *         PassportKit stack (IssuerRegistry → ClaimIssuer → IdentityFactory → EligibilityGate)
 *         → HouseTreasury (owners: operator + ana, policy 1) → CASA/mUSD v4 pool gated by
 *         MandateHook → concierge mandate funded and seeded with liquidity.
 *         Writes every address to apps/concierge/addresses.json.
 *
 * The operator plays every platform role here: admin, issuer signer (EIP-712) and LP.
 * Claims follow Model B — the operator SIGNS off-chain, the holder SUBMITS from their own wallet.
 * The concierge deliberately gets NO identity: its authority is the owners', never its own.
 *
 * Local anvil (dev accounts #0 operator, #1 ana, #2 concierge, #3 plumber — no env needed):
 *   forge script script/DeployConciergeDemo.s.sol --rpc-url http://localhost:8545 --broadcast
 *
 * Testnet (set env, see apps/concierge/.env.example):
 *   OPERATOR_PK / ANA_PK / CONCIERGE_PK / PLUMBER_PK — funded private keys (operator pays deploys)
 *   POOL_MANAGER                                     — canonical v4 PoolManager (skips local deploy)
 *   forge script script/DeployConciergeDemo.s.sol --rpc-url $RPC_URL --broadcast
 */
contract DeployConciergeDemo is Script {
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    uint256 constant ANVIL_OPERATOR_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant ANVIL_ANA_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant ANVIL_CONCIERGE_PK = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
    uint256 constant ANVIL_PLUMBER_PK = 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a;

    /// Policy ids are repo-wide constants (see apps/api/.env.example) — the house gates
    /// its owners on the Deal Room policy, exactly like the ComplianceHook demo's deal pool.
    uint256 constant POLICY_DEAL_ROOM = 1; // [KYC_VERIFIED]

    uint256 OPERATOR_PK;
    uint256 ANA_PK;
    uint256 CONCIERGE_PK;
    uint256 PLUMBER_PK;

    IssuerRegistry issuerRegistry;
    ClaimIssuer claimIssuer;
    IdentityFactory identityFactory;
    EligibilityGate eligibilityGate;
    PoolManager poolManager;
    PoolSwapTest swapRouter;
    DemoPositionRouter liquidityRouter;
    MockERC20 musd;
    HouseTreasury treasury;
    HouseToken casa;
    MandateHook hook;
    PoolKey poolKey;

    address operator;
    address ana;
    address concierge;
    address plumber;
    address operatorIdentity;
    address anaIdentity;
    uint256 nonce;

    function run() external {
        OPERATOR_PK = vm.envOr("OPERATOR_PK", ANVIL_OPERATOR_PK);
        ANA_PK = vm.envOr("ANA_PK", ANVIL_ANA_PK);
        CONCIERGE_PK = vm.envOr("CONCIERGE_PK", ANVIL_CONCIERGE_PK);
        PLUMBER_PK = vm.envOr("PLUMBER_PK", ANVIL_PLUMBER_PK);
        if (block.chainid != 31337) {
            require(
                OPERATOR_PK != ANVIL_OPERATOR_PK,
                "set OPERATOR_PK / ANA_PK / CONCIERGE_PK / PLUMBER_PK for non-local chains"
            );
        }

        operator = vm.addr(OPERATOR_PK);
        ana = vm.addr(ANA_PK);
        concierge = vm.addr(CONCIERGE_PK);
        plumber = vm.addr(PLUMBER_PK);

        vm.startBroadcast(OPERATOR_PK);
        _deployStack();
        _onboardOwners();
        _deployTreasury();
        _deployPoolInfra();
        _deployHookAndPool();
        _seedLiquidity();
        vm.stopBroadcast();

        // Model B: ana submits her own signed claim from her own wallet
        _submitClaim(ANA_PK, anaIdentity, ClaimTopics.KYC_VERIFIED);

        vm.startBroadcast(CONCIERGE_PK);
        casa.approve(address(swapRouter), type(uint256).max);
        musd.approve(address(swapRouter), type(uint256).max);
        vm.stopBroadcast();

        vm.startBroadcast(ANA_PK);
        musd.approve(address(liquidityRouter), type(uint256).max);
        musd.approve(address(treasury), type(uint256).max);
        vm.stopBroadcast();

        _writeAddresses();

        console.log("IssuerRegistry:     ", address(issuerRegistry));
        console.log("ClaimIssuer:        ", address(claimIssuer));
        console.log("IdentityFactory:    ", address(identityFactory));
        console.log("EligibilityGate:    ", address(eligibilityGate));
        console.log("PoolManager:        ", address(poolManager));
        console.log("HouseTreasury:      ", address(treasury));
        console.log("MandateHook:        ", address(hook));
    }

    function _deployStack() internal {
        issuerRegistry = new IssuerRegistry(operator);
        claimIssuer = new ClaimIssuer(operator, operator); // the operator key is the EIP-712 signer
        identityFactory = new IdentityFactory(operator, address(issuerRegistry));
        eligibilityGate = new EligibilityGate(operator, address(issuerRegistry));

        issuerRegistry.setTrusted(address(claimIssuer), ClaimTopics.KYC_VERIFIED, true);

        uint256[] memory dealTopics = new uint256[](1);
        dealTopics[0] = ClaimTopics.KYC_VERIFIED;
        eligibilityGate.setPolicy(POLICY_DEAL_ROOM, dealTopics);
    }

    /// One identity per house owner. The operator submits its own claim inline (it is the
    /// broadcaster here); ana's lands from her own wallet after this broadcast block.
    /// The concierge and the plumber get no identity — the agent's authority is the owners'.
    function _onboardOwners() internal {
        operatorIdentity = identityFactory.createIdentity(operator);
        anaIdentity = identityFactory.createIdentity(ana);

        _signAndSubmit(operatorIdentity, ClaimTopics.KYC_VERIFIED);
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

    function _deployTreasury() internal {
        musd = new MockERC20("Mock USD", "mUSD", 18);
        musd.mint(operator, 1_000_000 ether);
        musd.mint(ana, 1_000 ether);

        address[] memory owners = new address[](2);
        owners[0] = operator;
        owners[1] = ana;
        treasury = new HouseTreasury(
            owners,
            2,
            IERC20(address(musd)),
            IEligibilityGate(address(eligibilityGate)),
            IIdentityResolver(address(identityFactory)),
            POLICY_DEAL_ROOM,
            "Casa Azul Scrip",
            "CASA"
        );
        casa = treasury.HOUSE_TOKEN();

        musd.approve(address(treasury), 50_000 ether);
        treasury.deposit(50_000 ether);

        treasury.grantMandate(concierge, 200 ether, uint64(block.timestamp + 365 days));
        treasury.fundConcierge(500 ether);
    }

    function _deployPoolInfra() internal {
        address existingPoolManager = vm.envOr("POOL_MANAGER", address(0));
        poolManager = existingPoolManager != address(0)
            ? PoolManager(existingPoolManager)
            : new PoolManager(operator);
        swapRouter = new PoolSwapTest(poolManager);
        liquidityRouter = new DemoPositionRouter(poolManager);
    }

    function _deployHookAndPool() internal {
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);
        bytes memory args = abi.encode(poolManager, treasury);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, flags, type(MandateHook).creationCode, args);
        hook = new MandateHook{ salt: salt }(poolManager, IHouseTreasuryStanding(address(treasury)));
        require(address(hook) == hookAddress, "hook address mismatch");

        (Currency currency0, Currency currency1) = address(casa) < address(musd)
            ? (Currency.wrap(address(casa)), Currency.wrap(address(musd)))
            : (Currency.wrap(address(musd)), Currency.wrap(address(casa)));
        poolKey = PoolKey(currency0, currency1, 3000, 60, IHooks(address(hook)));
        poolManager.initialize(poolKey, SQRT_PRICE_1_1);
    }

    function _seedLiquidity() internal {
        // Temporary-mandate trick: mint seed CASA to operator so it can LP, then
        // restore the concierge's real mandate.
        treasury.grantMandate(operator, 0, uint64(block.timestamp + 365 days));
        treasury.fundConcierge(20_000 ether); // mints to operator (current mandate agent)
        treasury.grantMandate(concierge, 200 ether, uint64(block.timestamp + 365 days));

        casa.approve(address(liquidityRouter), type(uint256).max);
        musd.approve(address(liquidityRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity(
            poolKey, TickMath.minUsableTick(60), TickMath.maxUsableTick(60), 10_000e18, abi.encode(operator)
        );
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
            '  "musd": "', vm.toString(address(musd)), '",\n',
            '  "casa": "', vm.toString(address(casa)), '",\n',
            '  "treasury": "', vm.toString(address(treasury)), '",\n',
            '  "mandateHook": "', vm.toString(address(hook)), '",\n',
            '  "policyId": ', vm.toString(POLICY_DEAL_ROOM), ',\n',
            '  "fee": 3000,\n',
            '  "tickSpacing": 60,\n'
        );
        json = string.concat(
            json,
            '  "actors": {\n',
            '    "operator": "', vm.toString(operator), '",\n',
            '    "ana": "', vm.toString(ana), '",\n',
            '    "concierge": "', vm.toString(concierge), '",\n',
            '    "plumber": "', vm.toString(plumber), '"\n',
            '  },\n',
            '  "identities": {\n',
            '    "operator": "', vm.toString(operatorIdentity), '",\n',
            '    "ana": "', vm.toString(anaIdentity), '"\n',
            '  }\n',
            '}\n'
        );
        vm.writeFile("../apps/concierge/addresses.json", json);
    }
}
