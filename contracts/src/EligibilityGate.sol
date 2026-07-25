// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Reason, IClaimIssuer, ClaimTopics} from "./libraries/Types.sol";

interface IIdentity {
    /// @return exists false if there's no claim OR the holder locally removed it
    function getClaim(uint256 topic, address issuer)
        external view returns (bool exists, bytes memory sig, bytes memory data);
}

interface IIssuerRegistry {
    function issuersForTopic(uint256 topic) external view returns (address[] memory);
}

/**
 * @title EligibilityGate  ⭐ the ONE read every surface uses
 * @notice isEligible(identity, policyId) → (bool, reasonCode). A policy = required topics.
 *
 * AUTHORITATIVE reads: for each required topic, it asks the ISSUER (isClaimValid) whether the
 * claim still counts — checking the issuer's revocation + authorized signer. That's why the holder
 * controlling their own Identity can't override a platform revocation. One revoke → all surfaces flip.
 *
 * The loop is over `issuersForTopic` (our controlled set), so it can't be griefed.
 */
contract EligibilityGate is AccessControl {
    IIssuerRegistry public immutable issuers;
    mapping(uint256 => uint256[]) public policyTopics; // policyId => required topics

    event PolicySet(uint256 indexed policyId, uint256[] topics);

    error ZeroIssuerRegistry();
    error ZeroAdmin();

    constructor(address admin, address issuerRegistry) {
        if (admin == address(0)) revert ZeroAdmin();
        if (issuerRegistry == address(0)) revert ZeroIssuerRegistry();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        issuers = IIssuerRegistry(issuerRegistry);
    }

    function setPolicy(uint256 policyId, uint256[] calldata topics) external onlyRole(DEFAULT_ADMIN_ROLE) {
        policyTopics[policyId] = topics;
        emit PolicySet(policyId, topics);
    }

    function isEligible(address identity, uint256 policyId) external view returns (bool ok, bytes32 reason) {
        if (identity == address(0) || identity.code.length == 0) return (false, Reason.NO_IDENTITY);
        uint256[] storage req = policyTopics[policyId]; // storage ref — no memory copy
        if (req.length == 0) return (false, Reason.NO_POLICY); // fail-closed: an unset policy denies
        for (uint256 i; i < req.length; ++i) {
            if (!_hasValidClaim(identity, req[i])) return (false, _reasonFor(req[i]));
        }
        return (true, Reason.OK);
    }

    /// @dev For each trusted issuer of `topic`: read the claim off the identity, then re-verify
    ///      WITH THE ISSUER (revocation + signer + expiry). Authoritative, not the local flag.
    function _hasValidClaim(address identity, uint256 topic) internal view returns (bool) {
        address[] memory list = issuers.issuersForTopic(topic); // bounded by us
        for (uint256 j; j < list.length; ++j) {
            (bool exists, bytes memory sig, bytes memory data) = IIdentity(identity).getClaim(topic, list[j]);
            if (!exists) continue;
            // try/catch so a malformed claim is ignored, not allowed to brick verification
            try IClaimIssuer(list[j]).isClaimValid(identity, topic, sig, data) returns (bool valid) {
                if (valid) return true;
            } catch {
                continue;
            }
        }
        return false;
    }

    function _reasonFor(uint256 topic) internal pure returns (bytes32) {
        if (topic == ClaimTopics.KYC_VERIFIED)        return Reason.MISSING_KYC;
        if (topic == ClaimTopics.PROOF_OF_PERSONHOOD) return Reason.MISSING_PERSONHOOD;
        if (topic == ClaimTopics.ACCREDITED_INVESTOR) return Reason.MISSING_ACCREDITED;
        return Reason.MISSING_CLAIM;
    }
}
