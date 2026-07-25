// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {ClaimIssuer} from "../src/ClaimIssuer.sol";
import {EligibilityGate} from "../src/EligibilityGate.sol";
import {IdentityFactory} from "../src/IdentityFactory.sol";
import {ScoreRegistry} from "../src/ScoreRegistry.sol";
import {GatedERC20} from "../src/GatedERC20.sol";
import {PassportResolver} from "../src/ens/PassportResolver.sol";
import {PassportSubnameRegistrar} from "../src/ens/PassportSubnameRegistrar.sol";
import {ClaimTopics} from "../src/libraries/Types.sol";

/**
 * Deploy + wire the PassportKit stack on Ethereum Sepolia.
 *
 * Roles:
 *   - deployer (DEPLOYER_PRIVATE_KEY) = DEFAULT_ADMIN_ROLE on IssuerRegistry + EligibilityGate,
 *     so this script can wire setTrusted / setPolicy at deploy time.
 *   - agent (AGENT_ADDRESS, defaults to deployer) = the backend's on-chain key. Each of these
 *     constructors grants it DEFAULT_ADMIN_ROLE *and* the operator role: ClaimIssuer (AGENT_ROLE,
 *     setRevoked), IdentityFactory (AGENT_ROLE, createIdentity), GatedERC20 (MINTER_ROLE),
 *     PassportSubnameRegistrar (ISSUER_ROLE). For the demo one key is admin+operator; a production
 *     deployment should split admin from operator.
 *   - signer (ISSUER_SIGNER_ADDRESS, defaults to deployer) = the ClaimIssuer's authorized EIP-712 signer.
 *
 * Env: DEPLOYER_PRIVATE_KEY, AGENT_ADDRESS?, ISSUER_SIGNER_ADDRESS?, ENS_NAMEWRAPPER_ADDRESS?,
 *      ENS_PARENT_NODE? (namehash of the tenant's .eth — if set, wires the resolver tenant).
 * Run: forge script script/DeployPassportKit.s.sol --rpc-url $RPC_URL --broadcast --verify
 *
 * On success writes deployments/<chainid>.json (addresses + startBlock) for the subgraph + .env files.
 *
 * NOTE: agent-identity (linkAgent/unlinkAgent) lives on IdentityFactory (same constructor, no extra
 *       deploy step) — nothing to add here for it.
 *
 * Addresses are kept in storage (not stack) so run() stays under the local-variable limit.
 */
contract DeployPassportKit is Script {
    // ENS NameWrapper on Ethereum Sepolia (official) — used if ENS_NAMEWRAPPER_ADDRESS is unset.
    address internal constant SEPOLIA_NAME_WRAPPER = 0x0635513f179D50A207757E05759CbD106d7dFcE8;

    // Deployment outputs (storage, so serialization at the end doesn't blow the stack).
    address internal registryAddr;
    address internal issuerAddr;
    address internal gateAddr;
    address internal factoryAddr;
    address internal tokenAddr;
    address internal resolverAddr;
    address internal subnamesAddr;
    address internal scoreRegistryAddr;
    address internal adminAddr;
    address internal agentAddr;
    address internal signerAddr;
    uint256 internal startBlock;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        adminAddr = vm.addr(deployerKey);
        agentAddr = vm.envOr("AGENT_ADDRESS", adminAddr);
        signerAddr = vm.envOr("ISSUER_SIGNER_ADDRESS", adminAddr);
        address nameWrapper = vm.envOr("ENS_NAMEWRAPPER_ADDRESS", SEPOLIA_NAME_WRAPPER);
        bytes32 parentNode = vm.envOr("ENS_PARENT_NODE", bytes32(0));

        vm.startBroadcast(deployerKey);

        // 1. Issuer trust layer
        IssuerRegistry registry = new IssuerRegistry(adminAddr); // admin so we can setTrusted here
        ClaimIssuer issuer = new ClaimIssuer(agentAddr, signerAddr); // agent=AGENT_ROLE; signer authorized
        registry.setTrusted(address(issuer), ClaimTopics.KYC_VERIFIED, true);
        registry.setTrusted(address(issuer), ClaimTopics.PROOF_OF_PERSONHOOD, true);
        registry.setTrusted(address(issuer), ClaimTopics.ACCREDITED_INVESTOR, true);
        registryAddr = address(registry);
        issuerAddr = address(issuer);

        // 2. Gate + policies
        EligibilityGate gate = new EligibilityGate(adminAddr, address(registry));
        uint256[] memory dealRoom = new uint256[](1);
        dealRoom[0] = ClaimTopics.KYC_VERIFIED;
        gate.setPolicy(1, dealRoom); // policy #1 = Deal Room (KYC only)
        uint256[] memory investor = new uint256[](2);
        investor[0] = ClaimTopics.KYC_VERIFIED;
        investor[1] = ClaimTopics.ACCREDITED_INVESTOR;
        gate.setPolicy(2, investor); // policy #2 = investor (KYC + accredited)
        gateAddr = address(gate);

        // 3. Identity factory (agent creates identities; also holds linkAgent/unlinkAgent for x402 agents)
        factoryAddr = address(new IdentityFactory(agentAddr, address(registry)));

        // 4. Surfaces
        //    GatedERC20's "resolver" is the IdentityFactory (wallet -> identity); policy #1 (KYC).
        tokenAddr = address(new GatedERC20("PassportKit Demo", "PKD", address(gate), factoryAddr, 1, agentAddr));
        scoreRegistryAddr = address(new ScoreRegistry(agentAddr)); // agent = SCORER_ROLE (sets demo scores)
        // factory = ENSIP-25 agent registry; scoreRegistry = agent.reputation source
        PassportResolver resolver = new PassportResolver(factoryAddr, scoreRegistryAddr);
        resolverAddr = address(resolver);
        subnamesAddr = address(new PassportSubnameRegistrar(nameWrapper, address(resolver), agentAddr));

        // 5. ENS tenant wiring (only if a parent node is provided). Set-once for the demo:
        //    controller = the registrar so it can bind subnames via resolver.setIdentity. The
        //    tenant's gate/policy are not rotated afterwards (would need an admin path on the resolver).
        if (parentNode != bytes32(0)) {
            resolver.setTenant(parentNode, address(gate), 1, subnamesAddr);
        }

        startBlock = block.number;

        vm.stopBroadcast();

        _report();
        _writeDeployments();
    }

    // --- address table (copy into .env / README) ---
    function _report() internal view {
        console2.log("IssuerRegistry            ", registryAddr);
        console2.log("ClaimIssuer               ", issuerAddr);
        console2.log("EligibilityGate           ", gateAddr);
        console2.log("IdentityFactory           ", factoryAddr);
        console2.log("GatedERC20                ", tokenAddr);
        console2.log("PassportResolver          ", resolverAddr);
        console2.log("PassportSubnameRegistrar  ", subnamesAddr);
        console2.log("ScoreRegistry             ", scoreRegistryAddr);
        console2.log("--- roles ---");
        console2.log("admin (registry, gate)    ", adminAddr);
        console2.log("agent (issuer/factory/token/subnames)", agentAddr);
        console2.log("issuer signer             ", signerAddr);
        console2.log("startBlock                ", startBlock);
        // POST-DEPLOY (manual, needs the ENS name owner wallet):
        //   NameWrapper.setApprovalForAll(subnamesAddr, true)  -> lets the registrar mint subnames under the name
    }

    /**
     * Write deployments/<chainid>.json with addresses + roles + startBlock.
     * Consumed by: the subgraph manifest (IdentityFactory/ClaimIssuer/GatedERC20 address + startBlock)
     * and the api/web .env files. Requires `fs_permissions` for ./deployments in foundry.toml.
     */
    function _writeDeployments() internal {
        string memory obj = "deployments";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeUint(obj, "startBlock", startBlock);
        vm.serializeAddress(obj, "IssuerRegistry", registryAddr);
        vm.serializeAddress(obj, "ClaimIssuer", issuerAddr);
        vm.serializeAddress(obj, "EligibilityGate", gateAddr);
        vm.serializeAddress(obj, "IdentityFactory", factoryAddr);
        vm.serializeAddress(obj, "GatedERC20", tokenAddr);
        vm.serializeAddress(obj, "PassportResolver", resolverAddr);
        vm.serializeAddress(obj, "PassportSubnameRegistrar", subnamesAddr);
        vm.serializeAddress(obj, "ScoreRegistry", scoreRegistryAddr);
        vm.serializeAddress(obj, "admin", adminAddr);
        vm.serializeAddress(obj, "agent", agentAddr);
        string memory json = vm.serializeAddress(obj, "issuerSigner", signerAddr);

        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("wrote", path);
    }
}
