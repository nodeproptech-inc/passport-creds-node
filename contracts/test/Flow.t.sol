// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {ClaimIssuer} from "../src/ClaimIssuer.sol";
import {EligibilityGate} from "../src/EligibilityGate.sol";
import {IdentityFactory} from "../src/IdentityFactory.sol";
import {Identity} from "../src/Identity.sol";
import {ClaimTopics} from "../src/libraries/Types.sol";

/**
 * The capstone: the whole flow + the MONEY MOMENT, with REAL contracts (no mocks).
 *   onboard → issuer signs KYC → holder submits → eligible
 *   → revoke (issuer latch) → NOT eligible → re-open → eligible again
 */
contract FlowTest is Test {
    IssuerRegistry reg;
    ClaimIssuer issuer;
    EligibilityGate gate;
    IdentityFactory factory;

    address admin = address(0xA11CE);
    uint256 signerPk = 0xB0B;
    address signer;
    address user = address(0xBEEF);

    uint256 constant POLICY = 1;
    uint256 kyc;

    function setUp() public {
        signer = vm.addr(signerPk);
        kyc = ClaimTopics.KYC_VERIFIED;

        reg = new IssuerRegistry(admin);
        issuer = new ClaimIssuer(admin, signer);
        gate = new EligibilityGate(admin, address(reg));
        factory = new IdentityFactory(admin, address(reg));

        vm.startPrank(admin);
        reg.setTrusted(address(issuer), kyc, true);
        uint256[] memory topics = new uint256[](1);
        topics[0] = kyc;
        gate.setPolicy(POLICY, topics);
        vm.stopPrank();
    }

    function test_happy_then_revoke_then_reopen() public {
        // 1) onboard
        vm.prank(admin);
        address id = factory.createIdentity(user);

        // 2) issuer signs a KYC claim bound to THIS identity (off-chain in real life)
        bytes32 dataHash = keccak256("sanitized-kyc-result");
        uint64 exp = uint64(block.timestamp + 365 days);
        bytes32 nonce = keccak256("session-123");
        bytes memory data = abi.encode(dataHash, exp, nonce);
        bytes memory sig = _sign(id, kyc, dataHash, exp, nonce);

        // 3) the HOLDER submits their own signed claim (Model B)
        vm.prank(user);
        Identity(id).submitClaim(kyc, address(issuer), sig, data);

        // ✅ eligible
        (bool ok,) = gate.isEligible(id, POLICY);
        assertTrue(ok, "should be eligible after KYC");

        // 4) MONEY MOMENT: the platform (issuer) revokes → the gate flips
        vm.prank(admin);
        issuer.setRevoked(id, kyc, true);
        (bool ok2, bytes32 reason) = gate.isEligible(id, POLICY);
        assertFalse(ok2, "should NOT be eligible after revoke");
        assertEq(reason, bytes32("MISSING_KYC"));

        // 5) re-verification is issuer-gated: re-open the latch → eligible again
        vm.prank(admin);
        issuer.setRevoked(id, kyc, false);
        (bool ok3,) = gate.isEligible(id, POLICY);
        assertTrue(ok3, "eligible again after issuer re-opens");
    }

    function test_no_identity_returns_reason() public view {
        (bool ok, bytes32 reason) = gate.isEligible(address(0), POLICY);
        assertFalse(ok);
        assertEq(reason, bytes32("NO_IDENTITY"));
    }

    function test_no_claim_not_eligible() public {
        vm.prank(admin);
        address id = factory.createIdentity(user);
        (bool ok, bytes32 reason) = gate.isEligible(id, POLICY);
        assertFalse(ok, "no claim: not eligible");
        assertEq(reason, bytes32("MISSING_KYC"));
    }

    // --- EIP-712 signing helper ---
    function _sign(address id, uint256 topic, bytes32 dataHash, uint64 exp, bytes32 nonce)
        internal view returns (bytes memory)
    {
        bytes32 typeHash = keccak256(
            "Claim(address identity,uint256 topic,bytes32 dataHash,uint64 expiresAt,bytes32 nonce)"
        );
        bytes32 structHash = keccak256(abi.encode(typeHash, id, topic, dataHash, exp, nonce));
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("PassportKitClaim"), keccak256("1"), block.chainid, address(issuer)
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }
}
