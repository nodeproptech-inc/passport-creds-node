// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IEligibilityGate {
    function isEligible(address identity, uint256 policyId) external view returns (bool, bytes32);
}

/**
 * @title PassportResolver  (ENS surface - tenant-aware read-through)
 * @notice A custom ENS resolver whose text(node,key) is COMPUTED LIVE from the EligibilityGate.
 *         No setText, no keeper: revocation flips the name automatically.
 *
 * White-label / kit: one resolver serves N tenants. Each parentNode (a tenant's .eth) carries its
 * own (gate, policyId). So `alice.brandx.eth` and `bob.acme.eth` resolve against different gates
 * from the same contract.
 *
 * ENS calls `text(node, key)` off-chain (eth_call) -> the extra SLOADs cost the user nothing.
 */
contract PassportResolver {
    struct Tenant {
        IEligibilityGate gate;
        uint256 policyId;
        address controller;
    }

    mapping(bytes32 => Tenant) public tenantOf; // parentNode => tenant config
    mapping(bytes32 => address) public identityOf; // node => OnchainID
    mapping(bytes32 => bytes32) public parentOf; // node => parentNode

    event TenantSet(bytes32 indexed parentNode, address gate, uint256 policyId, address controller);
    event IdentitySet(bytes32 indexed node, bytes32 indexed parentNode, address identity);

    error NotController();
    error ZeroController();

    /// @notice A tenant registers their gate/policy for their parent name.
    ///         (auth: in production, restrict to the parent's ENS owner.)
    /// @dev Trust-on-first-use: the first set is open (the tenant's backend claims the
    ///      parentNode at onboarding); after that only the current controller can update.
    // NOTE: Production upgrade is full ENS-owner auth via NameWrapper.ownerOf(parentNode).
    function setTenant(bytes32 parentNode, address gate, uint256 policyId, address controller) external {
        if (controller == address(0)) revert ZeroController(); // zero controller would brick setIdentity
        Tenant storage existing = tenantOf[parentNode];
        if (existing.controller != address(0) && msg.sender != existing.controller) revert NotController();
        tenantOf[parentNode] = Tenant(IEligibilityGate(gate), policyId, controller);
        emit TenantSet(parentNode, gate, policyId, controller);
    }

    /// @notice Bind a subname node to an identity. Called by the tenant's controller/registrar.
    function setIdentity(bytes32 node, bytes32 parentNode, address identity) external {
        if (msg.sender != tenantOf[parentNode].controller) revert NotController();
        identityOf[node] = identity;
        parentOf[node] = parentNode;
        emit IdentitySet(node, parentNode, identity);
    }

    /// @notice ENS ITextResolver - computed live.
    function text(bytes32 node, string calldata key) external view returns (string memory) {
        address id = identityOf[node];
        Tenant memory t = tenantOf[parentOf[node]];
        bytes32 k = keccak256(bytes(key));
        if (k == keccak256("compliance.status")) {
            if (id == address(0) || address(t.gate).code.length == 0) return "NONE";
            (bool ok,) = t.gate.isEligible(id, t.policyId);
            return ok ? "GREEN" : "REVOKED"; // flips automatically on revocation
        }
        if (k == keccak256("compliance.identity")) return _toHex(id);
        return "";
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x59d1d43c // ITextResolver.text(bytes32,string)
            || id == 0x01ffc9a7; // ERC-165
    }

    /// @dev Render an address as a lowercase 0x-prefixed hex string.
    function _toHex(address a) internal pure returns (string memory) {
        bytes memory hexchars = "0123456789abcdef";
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i; i < 20; ++i) {
            out[2 + i * 2] = hexchars[uint8(uint160(a) >> ((8 * (19 - i)) + 4)) & 0x0f];
            out[2 + i * 2 + 1] = hexchars[uint8(uint160(a) >> (8 * (19 - i))) & 0x0f];
        }
        return string(out);
    }
}
