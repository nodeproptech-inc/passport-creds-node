// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ClaimRegistry} from "../src/ClaimRegistry.sol";
import {CompliancePassport} from "../src/CompliancePassport.sol";
import {AccessGate} from "../src/AccessGate.sol";

/**
 * @title DeployPassportCreds
 * @notice Deploys the full PassportCreds contract suite in order:
 *         ClaimRegistry → CompliancePassport → AccessGate.
 *
 * Usage (local anvil):
 *   forge script script/DeployPassportCreds.s.sol \
 *     --rpc-url http://localhost:8545 --broadcast
 *
 * Usage (testnet):
 *   forge script script/DeployPassportCreds.s.sol \
 *     --rpc-url $RPC_URL --broadcast --verify --etherscan-api-key $ETHERSCAN_KEY
 *
 * Environment variables required:
 *   DEPLOYER_PRIVATE_KEY  — private key of the deployer wallet
 *   CRE_UPDATER_ADDRESS   — wallet that the CRE node will use to submit claims
 *
 * The deployer wallet receives DEFAULT_ADMIN_ROLE and ISSUER_ADMIN_ROLE on
 * both ClaimRegistry and CompliancePassport. The CRE_UPDATER_ADDRESS receives
 * CRE_UPDATER_ROLE on both contracts.
 */
contract DeployPassportCreds is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address creUpdater = vm.envAddress("CRE_UPDATER_ADDRESS");

        console.log("Deployer:    ", deployer);
        console.log("CRE updater: ", creUpdater);

        vm.startBroadcast(deployerKey);

        // 1. ClaimRegistry — stores all claim results from the CRE
        ClaimRegistry registry = new ClaimRegistry(deployer);
        console.log("ClaimRegistry deployed at:      ", address(registry));

        // 2. CompliancePassport — soulbound ERC721 with status derived from registry
        CompliancePassport passport = new CompliancePassport(deployer, address(registry));
        console.log("CompliancePassport deployed at: ", address(passport));

        // 3. AccessGate — stateless read-only gate checked by dApps
        AccessGate gate = new AccessGate(address(registry), address(passport));
        console.log("AccessGate deployed at:         ", address(gate));

        // 4. Grant CRE_UPDATER_ROLE so the CRE node can write claims and sync passports
        registry.grantRole(registry.CRE_UPDATER_ROLE(), creUpdater);
        passport.grantRole(passport.CRE_UPDATER_ROLE(), creUpdater);

        console.log("CRE_UPDATER_ROLE granted to:    ", creUpdater);

        vm.stopBroadcast();

        // Print a JSON block that the backend reads from deployments.json
        console.log("\n--- deployments.json ---");
        console.log("{");
        console.log('  "ClaimRegistry":      "%s",', address(registry));
        console.log('  "CompliancePassport": "%s",', address(passport));
        console.log('  "AccessGate":         "%s"', address(gate));
        console.log("}");
    }
}
