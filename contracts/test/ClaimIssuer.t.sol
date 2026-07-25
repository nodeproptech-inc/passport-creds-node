// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClaimIssuer} from "../src/ClaimIssuer.sol";
import {ClaimTopics} from "../src/libraries/Types.sol";

contract ClaimIssuerTest is Test {
    ClaimIssuer issuer;
    address admin = address(0xA11CE);
    uint256 signerPk = 0xB0B;
    address signer;
    address identity = address(0x1234);
    uint256 kyc;

    function setUp() public {
        signer = vm.addr(signerPk);
        kyc = ClaimTopics.KYC_VERIFIED;
        issuer = new ClaimIssuer(admin, signer);
    }

    function _data(bytes32 dataHash, uint64 exp, bytes32 nonce) internal pure returns (bytes memory) {
        return abi.encode(dataHash, exp, nonce);
    }

    /// Build the EIP-712 signature the ClaimIssuer expects.
    function _sign(uint256 pk, address id, uint256 topic, bytes32 dataHash, uint64 exp, bytes32 nonce)
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
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_valid_signature() public view {
        bytes32 dh = keccak256("kyc");
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes32 nonce = keccak256("n1");
        bytes memory sig = _sign(signerPk, identity, kyc, dh, exp, nonce);
        assertTrue(issuer.isClaimValid(identity, kyc, sig, _data(dh, exp, nonce)));
    }

    function test_nonAuthorizedSigner_invalid() public view {
        bytes32 dh = keccak256("kyc");
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes32 nonce = keccak256("n1");
        bytes memory sig = _sign(0xDEAD, identity, kyc, dh, exp, nonce); // random signer
        assertFalse(issuer.isClaimValid(identity, kyc, sig, _data(dh, exp, nonce)));
    }

    function test_replay_wrong_identity_invalid() public view {
        bytes32 dh = keccak256("kyc");
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes32 nonce = keccak256("n1");
        bytes memory sig = _sign(signerPk, identity, kyc, dh, exp, nonce); // signed FOR `identity`
        assertFalse(issuer.isClaimValid(address(0x9999), kyc, sig, _data(dh, exp, nonce)));
    }

    function test_zero_dataHash_invalid() public view {
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes32 nonce = keccak256("n1");
        bytes memory sig = _sign(signerPk, identity, kyc, bytes32(0), exp, nonce);
        assertFalse(issuer.isClaimValid(identity, kyc, sig, _data(bytes32(0), exp, nonce)));
    }

    function test_expired_invalid() public {
        bytes32 dh = keccak256("kyc");
        uint64 exp = uint64(block.timestamp + 100);
        bytes32 nonce = keccak256("n1");
        bytes memory sig = _sign(signerPk, identity, kyc, dh, exp, nonce);
        vm.warp(block.timestamp + 200); // past expiry
        assertFalse(issuer.isClaimValid(identity, kyc, sig, _data(dh, exp, nonce)));
    }

    function test_revoke_latch_then_reopen() public {
        bytes32 dh = keccak256("kyc");
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes32 nonce = keccak256("n1");
        bytes memory sig = _sign(signerPk, identity, kyc, dh, exp, nonce);
        bytes memory data = _data(dh, exp, nonce);
        assertTrue(issuer.isClaimValid(identity, kyc, sig, data));

        vm.prank(admin);
        issuer.setRevoked(identity, kyc, true);
        assertFalse(issuer.isClaimValid(identity, kyc, sig, data)); // latch holds

        vm.prank(admin);
        issuer.setRevoked(identity, kyc, false);
        assertTrue(issuer.isClaimValid(identity, kyc, sig, data)); // issuer re-opened
    }

    function test_setSigner_off_invalidates_globally() public {
        bytes32 dh = keccak256("kyc");
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes32 nonce = keccak256("n1");
        bytes memory sig = _sign(signerPk, identity, kyc, dh, exp, nonce);
        bytes memory data = _data(dh, exp, nonce);
        assertTrue(issuer.isClaimValid(identity, kyc, sig, data));

        vm.prank(admin);
        issuer.setSigner(signer, false);
        assertFalse(issuer.isClaimValid(identity, kyc, sig, data)); // global lever
    }

    function test_setRevoked_onlyAgent() public {
        vm.prank(address(0xCAFE));
        vm.expectRevert();
        issuer.setRevoked(identity, kyc, true);
    }

    function test_malformed_data_returns_false() public view {
        bytes memory someSig = hex"1234";
        // data is NOT 96 bytes -> total validator returns false instead of reverting
        assertFalse(issuer.isClaimValid(identity, kyc, someSig, hex"1234"));
    }

    function test_malformed_sig_returns_false() public view {
        bytes32 dh = keccak256("kyc");
        uint64 exp = uint64(block.timestamp + 1 days);
        bytes32 nonce = keccak256("n1");
        bytes memory data = _data(dh, exp, nonce); // valid 96-byte encoding
        bytes memory bogusSig = hex"1234";         // malformed short signature
        // malformed sig -> tryRecover errors -> false, not a revert
        assertFalse(issuer.isClaimValid(identity, kyc, bogusSig, data));
    }
}
