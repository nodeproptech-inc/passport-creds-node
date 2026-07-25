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
 * Agent identities (x402), Model A = delegation by mapping.
 *   identityOfWallet[agentWallet] = personIdentity
 * The agent holds NO claims of its own; surfaces resolve agent → person → isEligible.
 *
 * Money moment v2: revoke the PERSON → every agent flips at once (same identity).
 * Surgical lever: unlinkAgent(one) blocks that agent alone; person + other agents stay eligible.
 */
contract AgentIdentityTest is Test {
    IssuerRegistry reg;
    ClaimIssuer issuer;
    EligibilityGate gate;
    IdentityFactory factory;

    address admin = address(0xA11CE);
    uint256 signerPk = 0xB0B;
    address signer;
    address user = address(0xBEEF);

    address agentA = address(0xA6E71);
    address agentB = address(0xA6E72);
    address stranger = address(0x5747A);

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

    // ── the agent inherits the person's eligibility (Model A) ─────────────────
    function test_linkAgent_inherits_person_eligibility() public {
        address id = _onboardPersonWithKyc();

        vm.prank(admin);
        factory.linkAgent(agentA, id);

        assertEq(factory.identityOfWallet(agentA), id, "agent resolves to person identity");
        (bool ok,) = gate.isEligible(factory.identityOfWallet(agentA), POLICY);
        assertTrue(ok, "agent is eligible because the person is");
    }

    // ── MONEY MOMENT v2: revoke the person → ALL their agents blocked at once ──
    function test_revoke_person_cascades_to_all_agents() public {
        address id = _onboardPersonWithKyc();
        vm.startPrank(admin);
        factory.linkAgent(agentA, id);
        factory.linkAgent(agentB, id);
        vm.stopPrank();

        // both agents eligible
        (bool a1,) = gate.isEligible(factory.identityOfWallet(agentA), POLICY);
        (bool b1,) = gate.isEligible(factory.identityOfWallet(agentB), POLICY);
        assertTrue(a1 && b1, "both agents eligible before revoke");

        // revoke the PERSON's KYC (issuer latch) → both agents flip (same identity)
        vm.prank(admin);
        issuer.setRevoked(id, kyc, true);
        (bool a2, bytes32 rA) = gate.isEligible(factory.identityOfWallet(agentA), POLICY);
        (bool b2, bytes32 rB) = gate.isEligible(factory.identityOfWallet(agentB), POLICY);
        assertFalse(a2, "agentA blocked after person revoke");
        assertFalse(b2, "agentB blocked after person revoke");
        assertEq(rA, bytes32("MISSING_KYC"));
        assertEq(rB, bytes32("MISSING_KYC"));

        // issuer re-opens → both agents eligible again
        vm.prank(admin);
        issuer.setRevoked(id, kyc, false);
        (bool a3,) = gate.isEligible(factory.identityOfWallet(agentA), POLICY);
        (bool b3,) = gate.isEligible(factory.identityOfWallet(agentB), POLICY);
        assertTrue(a3 && b3, "both agents eligible again after re-open");
    }

    // ── surgical lever: unlink ONE agent, person + others unaffected ──────────
    function test_unlinkAgent_blocks_only_that_agent() public {
        address id = _onboardPersonWithKyc();
        vm.startPrank(admin);
        factory.linkAgent(agentA, id);
        factory.linkAgent(agentB, id);
        factory.unlinkAgent(agentA);
        vm.stopPrank();

        // agentA now resolves to address(0) → gate refuses with NO_IDENTITY
        assertEq(factory.identityOfWallet(agentA), address(0), "agentA unlinked");
        (bool a, bytes32 rA) = gate.isEligible(factory.identityOfWallet(agentA), POLICY);
        assertFalse(a, "agentA blocked after unlink");
        assertEq(rA, bytes32("NO_IDENTITY"));

        // agentB and the person are untouched
        (bool b,) = gate.isEligible(factory.identityOfWallet(agentB), POLICY);
        (bool p,) = gate.isEligible(id, POLICY);
        assertTrue(b, "agentB still eligible");
        assertTrue(p, "person still eligible");
    }

    function test_multiple_agents_same_identity() public {
        address id = _onboardPersonWithKyc();
        vm.startPrank(admin);
        factory.linkAgent(agentA, id);
        factory.linkAgent(agentB, id);
        vm.stopPrank();
        assertEq(factory.identityOfWallet(agentA), id);
        assertEq(factory.identityOfWallet(agentB), id);
    }

    // ── guards ────────────────────────────────────────────────────────────────
    function test_linkAgent_reverts_zero_agent() public {
        address id = _onboardPersonWithKyc();
        vm.prank(admin);
        vm.expectRevert(IdentityFactory.ZeroAgent.selector);
        factory.linkAgent(address(0), id);
    }

    function test_linkAgent_reverts_not_an_identity() public {
        vm.prank(admin);
        vm.expectRevert(IdentityFactory.NotAnIdentity.selector);
        factory.linkAgent(agentA, stranger); // stranger was never minted as an identity
    }

    function test_linkAgent_reverts_wallet_in_use_by_agent() public {
        address id = _onboardPersonWithKyc();
        vm.startPrank(admin);
        factory.linkAgent(agentA, id);
        vm.expectRevert(IdentityFactory.WalletInUse.selector);
        factory.linkAgent(agentA, id); // double link
        vm.stopPrank();
    }

    function test_linkAgent_reverts_wallet_in_use_by_person() public {
        address id = _onboardPersonWithKyc();
        vm.prank(admin);
        vm.expectRevert(IdentityFactory.WalletInUse.selector);
        factory.linkAgent(user, id); // `user` already owns an identity
    }

    function test_linkAgent_onlyAgentRole() public {
        address id = _onboardPersonWithKyc();
        bytes32 role = factory.AGENT_ROLE(); // read BEFORE prank (a call here would consume the prank)
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSignature("AccessControlUnauthorizedAccount(address,bytes32)", stranger, role)
        );
        factory.linkAgent(agentA, id);
    }

    function test_unlinkAgent_reverts_not_linked() public {
        vm.prank(admin);
        vm.expectRevert(IdentityFactory.NotLinked.selector);
        factory.unlinkAgent(agentA);
    }

    /// @dev regression: unlinkAgent must NOT accept a person's own wallet (would brick their resolution)
    function test_unlinkAgent_reverts_on_person_wallet() public {
        address id = _onboardPersonWithKyc();
        vm.prank(admin);
        vm.expectRevert(IdentityFactory.NotLinked.selector);
        factory.unlinkAgent(user); // `user` is a PERSON wallet, not an agent

        // person is untouched: still resolves + still eligible
        assertEq(factory.identityOfWallet(user), id, "person mapping intact");
        (bool ok,) = gate.isEligible(id, POLICY);
        assertTrue(ok, "person still eligible");
    }

    // ── helpers ────────────────────────────────────────────────────────────────
    function _onboardPersonWithKyc() internal returns (address id) {
        vm.prank(admin);
        id = factory.createIdentity(user);

        bytes32 dataHash = keccak256("sanitized-kyc-result");
        uint64 exp = uint64(block.timestamp + 365 days);
        bytes32 nonce = keccak256("session-agent");
        bytes memory data = abi.encode(dataHash, exp, nonce);
        bytes memory sig = _sign(id, kyc, dataHash, exp, nonce);

        vm.prank(user);
        Identity(id).submitClaim(kyc, address(issuer), sig, data);
    }

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
