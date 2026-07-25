// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

interface INameWrapper {
    function setSubnodeRecord(
        bytes32 parentNode,
        string calldata label,
        address owner,
        address resolver,
        uint64 ttl,
        uint32 fuses,
        uint64 expiry
    ) external returns (bytes32 node);
}

interface IPassportResolver {
    function setIdentity(bytes32 node, bytes32 parentNode, address identity) external;
}

/**
 * @title PassportSubnameRegistrar  (ENS surface - issue subnames BY CODE)
 * @notice The "kit" piece: given a tenant name the tenant already owns, issue compliant subnames
 *         under it (user.tenant.eth) pointing at the PassportResolver, and bind node -> identity.
 *
 * White-label: the tenant grants this registrar `setApprovalForAll` on the NameWrapper (or calls
 * via their owner wallet). Subnames are created programmatically - zero manual UI. This is what
 * makes PassportKit an SDK: a tenant onboards users and the kit mints their identity name by code.
 */
contract PassportSubnameRegistrar is AccessControl {
    INameWrapper public immutable nameWrapper;
    IPassportResolver public immutable resolver;

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    // demo defaults; tune per tenant/name policy
    uint32 public constant FUSES = 0;
    uint64 public constant EXPIRY = type(uint64).max;

    event SubnameIssued(bytes32 indexed parentNode, string label, address indexed userWallet, address identity);

    error ZeroAdmin();
    error ZeroNameWrapper();
    error ZeroResolver();

    constructor(address nameWrapper_, address resolver_, address admin) {
        if (nameWrapper_ == address(0)) revert ZeroNameWrapper();
        if (resolver_ == address(0)) revert ZeroResolver();
        if (admin == address(0)) revert ZeroAdmin();
        nameWrapper = INameWrapper(nameWrapper_);
        resolver = IPassportResolver(resolver_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
    }

    /// @notice Issue `label.<tenant>.eth` owned by the user, resolving via PassportResolver.
    function issueSubname(bytes32 parentNode, string calldata label, address userWallet, address identity)
        external
        onlyRole(ISSUER_ROLE)
        returns (bytes32 node)
    {
        // (auth: gate to the tenant's controller/backend in production)
        node = nameWrapper.setSubnodeRecord(parentNode, label, userWallet, address(resolver), 0, FUSES, EXPIRY);
        // node == keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))))
        resolver.setIdentity(node, parentNode, identity);
        emit SubnameIssued(parentNode, label, userWallet, identity);
    }
}
